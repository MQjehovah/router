import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { keyVerifyCache } from '../key-cache.js';
import { encrypt, decrypt } from '../crypto-utils.js';
import { encryptionKey } from '../env.js';

/** 启动即校验:生产环境缺失/弱值会让进程在模块加载时立刻失败;开发回退开发密钥。 */
const ENCRYPTION_KEY = encryptionKey();

/// SSO 自动开通的 key 统一命名，交换端点按该名字 find-or-create
export const SSO_KEY_NAME = 'sso';

export interface EnsureUserKeyOptions {
  rateLimit?: number;
  dailyQuota?: number;
  monthlyQuota?: number;
}

export interface EnsuredUserKey {
  key: string;
  keyId: number;
  created: boolean;
  rotated: boolean;
  rateLimit: number;
  dailyQuota: number;
  monthlyQuota: number;
}

/// 按用户 find-or-create key，保证幂等：已有则重复发放同一把
/// （逻辑删除的 key 不参与复用，否则会发出一把已失效的密钥）
export async function ensureUserKey(
  prisma: PrismaClient,
  userId: number,
  opts: EnsureUserKeyOptions = {}
): Promise<EnsuredUserKey> {
  const existing = await prisma.apiKey.findFirst({
    where: { userId, name: SSO_KEY_NAME, status: 'ACTIVE', deletedAt: null },
    orderBy: { id: 'desc' }
  });

  let key: string;
  let keyId: number;
  let created = false;
  let rotated = false;

  if (existing?.keyEncrypted) {
    keyId = existing.id;
    key = decrypt(existing.keyEncrypted, ENCRYPTION_KEY);
  } else {
    key = `sk-${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = bcrypt.hashSync(key, 10);
    const keyEncrypted = encrypt(key, ENCRYPTION_KEY);

    if (existing) {
      // 旧 key 没有加密副本（历史数据），轮换后补上，旧 key 立即失效
      const updated = await prisma.apiKey.update({
        where: { id: existing.id },
        data: { keyHash, keyEncrypted }
      });
      keyId = updated.id;
      rotated = true;
    } else {
      const row = await prisma.apiKey.create({
        data: {
          userId,
          keyHash,
          keyEncrypted,
          name: SSO_KEY_NAME,
          rateLimit: opts.rateLimit || 60,
          dailyQuota: opts.dailyQuota ?? 100000,
          monthlyQuota: opts.monthlyQuota ?? 3000000
        }
      });
      keyId = row.id;
      created = true;
    }
    keyVerifyCache.clear();
  }

  return {
    key,
    keyId,
    created,
    rotated,
    rateLimit: existing?.rateLimit ?? opts.rateLimit ?? 60,
    dailyQuota: Number(existing?.dailyQuota ?? opts.dailyQuota ?? 100000),
    monthlyQuota: Number(existing?.monthlyQuota ?? opts.monthlyQuota ?? 3000000)
  };
}
