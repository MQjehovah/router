import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { keyVerifyCache } from '../key-cache.js';
import { writeAudit } from '../audit.js';
import { encrypt, decrypt } from '../crypto-utils.js';
import { isOidcConfigured, verifyIdToken, extractEmployeeId } from '../oidc.js';

const prisma = new PrismaClient();

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

    const email = typeof payload.email === 'string' && payload.email ? payload.email : null;
    const name = typeof payload.name === 'string' && payload.name ? payload.name : employeeId;

    // 按工号 find-or-create 用户，密码为随机值（SSO 用户不通过控制台密码登录）
    let user = await prisma.user.findUnique({ where: { employeeId } });
    let userCreated = false;
    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      user = await prisma.user.create({
        data: {
          employeeId,
          email,
          name,
          role: 'USER',
          passwordHash: await bcrypt.hash(randomPassword, 10)
        }
      });
      userCreated = true;
    } else if (email && user.email !== email) {
      user = await prisma.user.update({ where: { id: user.id }, data: { email } });
    }

    // 按用户 find-or-create key，保证幂等：已有则重复发放同一把
    let existing = await prisma.apiKey.findFirst({
      where: { userId: user.id, name: SSO_KEY_NAME, status: 'ACTIVE' },
      orderBy: { id: 'desc' }
    });

    const encryptionKey = process.env.ENCRYPTION_KEY || 'default-key';
    let rawKey: string;
    let keyId: number;
    let rotated = false;

    if (existing?.keyEncrypted) {
      keyId = existing.id;
      rawKey = decrypt(existing.keyEncrypted, encryptionKey);
    } else {
      rawKey = `sk-${crypto.randomBytes(32).toString('hex')}`;
      const keyHash = bcrypt.hashSync(rawKey, 10);
      const keyEncrypted = encrypt(rawKey, encryptionKey);

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
      detail: { employeeId, userCreated, created: !existing, rotated }
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
