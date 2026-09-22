import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { keyVerifyCache } from '../key-cache.js';
import { writeAudit } from '../audit.js';
import { encrypt, decrypt } from '../crypto-utils.js';
import { isOidcConfigured, verifyIdToken, extractEmployeeId } from '../oidc.js';
import { encryptionKey } from '../env.js';

const prisma = new PrismaClient();

/** 启动即校验:生产环境缺失/弱值会让进程在模块加载时立刻失败;开发回退开发密钥。 */
const ENCRYPTION_KEY = encryptionKey();

/// SSO 自动开通的 key 统一命名，交换端点按该名字 find-or-create
const SSO_KEY_NAME = 'sso';

interface ExchangeBody {
  idToken: string;
  rateLimit?: number;
  dailyQuota?: number;
  monthlyQuota?: number;
}

export async function ssoRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: ExchangeBody }>('/internal/sso/exchange', async (req, reply) => {
    const secret = req.headers['x-internal-secret'];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: 'Invalid internal secret' });
    }

    if (!isOidcConfigured()) {
      return reply.status(503).send({ error: 'OIDC not configured (OIDC_ISSUER / OIDC_AUDIENCE missing)' });
    }

    const idToken = req.body?.idToken;
    if (!idToken) {
      return reply.status(400).send({ error: 'idToken is required' });
    }

    let payload;
    try {
      payload = await verifyIdToken(idToken);
    } catch (err: any) {
      return reply.status(401).send({ error: `Invalid ID token: ${err?.message || 'verification failed'}` });
    }

    const employeeId = extractEmployeeId(payload);
    if (!employeeId) {
      return reply.status(401).send({ error: 'ID token has no employee id claim' });
    }

    // SSO 的 id_token 不含 email（统一认证只签发 工号/姓名/部门/角色），
    // 因此用 工号@域名 派生一个稳定、可辨识的邮箱，账号管理里才能认出是谁；
    // 若该地址已被别的账号占用则保持为空，避免唯一约束冲突导致 500。
    // 邮箱(LDAP mail)是首选唯一标识: 用于与系统自建账号(按邮箱登录的)对齐,
    // 避免同一人出现两个账号;不自行拼接邮箱,取不到就留空。
    const email = typeof payload.email === 'string' && payload.email.trim()
      ? payload.email.trim().toLowerCase()
      : null;
    const name = typeof payload.name === 'string' && payload.name ? payload.name : employeeId;

    // 身份识别顺序: 邮箱 -> 工号 -> 新建(密码为随机值,SSO 用户不走控制台密码登录)
    let matchedBy = '';
    let user = email ? await prisma.user.findUnique({ where: { email } }) : null;
    if (user) {
      matchedBy = 'email';
      if (!user.employeeId) {
        // 命中同邮箱的系统自建账号: 补绑工号,把它接入统一认证
        try {
          user = await prisma.user.update({ where: { id: user.id }, data: { employeeId } });
          matchedBy = 'email+link';
        } catch {
          // 该工号已被别的账号占用(历史重复账号): 退回按工号匹配,避免 500
          console.warn(`[sso] 工号 ${employeeId} 已被占用,无法绑定到邮箱账号 ${email},改按工号匹配`);
          user = null;
          matchedBy = '';
        }
      } else if (user.employeeId !== employeeId) {
        console.warn(`[sso] 邮箱 ${email} 对应工号 ${user.employeeId}, 与本次登录工号 ${employeeId} 不一致, 改按工号匹配`);
        user = null;
        matchedBy = '';
      }
    }
    if (!user) {
      user = await prisma.user.findUnique({ where: { employeeId } });
      if (user) matchedBy = 'employeeId';
    }

    let userCreated = false;
    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      // 新开通员工给初始额度(内部免手动开号即用);额度用尽后由管理员充值
      const initialBalance = Number(process.env.SSO_INITIAL_BALANCE ?? 100);
      user = await prisma.user.create({
        data: {
          employeeId,
          email,
          name,
          role: 'USER',
          balance: initialBalance,
          balanceResetAt: new Date(),
          passwordHash: await bcrypt.hash(randomPassword, 10)
        }
      });
      userCreated = true;
      matchedBy = 'created';
    } else {
      const patch: { name?: string; email?: string } = {};
      if (name && user.name !== name) patch.name = name;
      // 历史账号缺邮箱时用 id_token 的 LDAP mail 回填(仅补空, 不覆盖已有值)
      if (email && !user.email) patch.email = email;
      if (Object.keys(patch).length > 0) {
        try {
          user = await prisma.user.update({ where: { id: user.id }, data: patch });
          if (patch.email) matchedBy = matchedBy ? `${matchedBy}+email` : 'email-backfill';
        } catch (err) {
          console.warn(`[sso] 回填用户信息失败(${Object.keys(patch).join(',')}): ${(err as Error).message}`);
        }
      }
    }

      // 按用户 find-or-create key，保证幂等：已有则重复发放同一把
      // （逻辑删除的 key 不参与复用，否则会发出一把已失效的密钥）
      let existing = await prisma.apiKey.findFirst({
        where: { userId: user.id, name: SSO_KEY_NAME, status: 'ACTIVE', deletedAt: null },
        orderBy: { id: 'desc' }
      });

    let rawKey: string;
    let keyId: number;
    let rotated = false;

    if (existing?.keyEncrypted) {
      keyId = existing.id;
      rawKey = decrypt(existing.keyEncrypted, ENCRYPTION_KEY);
    } else {
      rawKey = `sk-${crypto.randomBytes(32).toString('hex')}`;
      const keyHash = bcrypt.hashSync(rawKey, 10);
      const keyEncrypted = encrypt(rawKey, ENCRYPTION_KEY);

      if (existing) {
        // 旧 key 没有加密副本（历史数据），轮换后补上，旧 key 立即失效
        const updated = await prisma.apiKey.update({
          where: { id: existing.id },
          data: { keyHash, keyEncrypted }
        });
        keyId = updated.id;
        rotated = true;
      } else {
        const created = await prisma.apiKey.create({
          data: {
            userId: user.id,
            keyHash,
            keyEncrypted,
            name: SSO_KEY_NAME,
            rateLimit: req.body?.rateLimit || 60,
            dailyQuota: req.body?.dailyQuota ?? 100000,
            monthlyQuota: req.body?.monthlyQuota ?? 3000000
          }
        });
        keyId = created.id;
      }
      keyVerifyCache.clear();
    }

    writeAudit({
      actorId: user.id,
      action: 'sso_exchange',
      targetType: 'key',
      targetId: keyId,
      detail: { employeeId, userCreated, matchedBy, created: !existing, rotated }
    });

    return {
      key: rawKey,
      keyId,
      userId: user.id,
      employeeId,
      name: user.name,
      email: user.email,
      created: !existing,
      rotated,
      rateLimit: existing?.rateLimit ?? req.body?.rateLimit ?? 60,
      dailyQuota: Number(existing?.dailyQuota ?? req.body?.dailyQuota ?? 100000),
      monthlyQuota: Number(existing?.monthlyQuota ?? req.body?.monthlyQuota ?? 3000000)
    };
  });
}
