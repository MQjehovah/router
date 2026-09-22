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

/** 未显式传参/无 key 回显时的默认限流与配额(与 ApiKey schema 默认值一致) */
export const DEFAULT_RATE_LIMIT = 60;
export const DEFAULT_DAILY_QUOTA = 100000;
export const DEFAULT_MONTHLY_QUOTA = 3000000;

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
  // 进门归一化: 落库与回显共用同一语义(0 是合法限速值, 不再被 || 回退成 60)
  const rateLimit = opts.rateLimit ?? DEFAULT_RATE_LIMIT;

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
          rateLimit,
          dailyQuota: opts.dailyQuota ?? DEFAULT_DAILY_QUOTA,
          monthlyQuota: opts.monthlyQuota ?? DEFAULT_MONTHLY_QUOTA
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
    rateLimit: existing?.rateLimit ?? rateLimit,
    dailyQuota: Number(existing?.dailyQuota ?? opts.dailyQuota ?? DEFAULT_DAILY_QUOTA),
    monthlyQuota: Number(existing?.monthlyQuota ?? opts.monthlyQuota ?? DEFAULT_MONTHLY_QUOTA)
  };
}
