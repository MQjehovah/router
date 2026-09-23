import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from '../src/crypto-utils.js';
import { encryptionKey } from '../src/env.js';
import { keyVerifyCache } from '../src/key-cache.js';
import {
  ensureUserKey,
  SSO_KEY_NAME,
  LEGACY_SSO_KEY_NAMES,
  DEFAULT_RATE_LIMIT,
  DEFAULT_DAILY_QUOTA,
  DEFAULT_MONTHLY_QUOTA
} from '../src/services/user-key.js';

const ENCRYPTION_KEY = encryptionKey();

interface KeyRow {
  id: number;
  name: string;
  isSystem: boolean;
  keyEncrypted: string | null;
  rateLimit: number;
  dailyQuota: number;
  monthlyQuota: number;
}

// 沿用仓库「最小替身 + 断言调用参数」的测试风格: ensureUserKey 只依赖 prisma.apiKey 的三个方法,
// 这里用内存替身记录调用, 校验 find-or-create 的查询条件与写入数据。
function fakePrisma(existing: KeyRow | null) {
  const calls = {
    findFirst: 0,
    create: 0,
    update: 0,
    lastWhere: null as any,
    lastCreate: null as any,
    lastUpdate: null as any
  };
  const prisma = {
    apiKey: {
      findFirst: async (args: any) => {
        calls.findFirst++;
        calls.lastWhere = args;
        return existing;
      },
      create: async (args: any) => {
        calls.create++;
        calls.lastCreate = args;
        return { id: 101, ...args.data };
      },
      update: async (args: any) => {
        calls.update++;
        calls.lastUpdate = args;
        if (existing) Object.assign(existing, args.data);
        return { id: args.where.id };
      }
    }
  };
  return { prisma: prisma as unknown as PrismaClient, calls };
}

test('ensureUserKey: 无 key 时创建新 key(created=true, 默认密钥/系统托管/落默认额度)', async () => {
  const { prisma, calls } = fakePrisma(null);
  keyVerifyCache.set('probe-create', { valid: false, reason: 'stale' });

  const result = await ensureUserKey(prisma, 42);

  assert.equal(result.created, true);
  assert.equal(result.rotated, false);
  assert.match(result.key, /^sk-[0-9a-f]{64}$/);
  assert.equal(result.keyId, 101);
  assert.equal(result.rateLimit, DEFAULT_RATE_LIMIT);
  assert.equal(result.dailyQuota, DEFAULT_DAILY_QUOTA);
  assert.equal(result.monthlyQuota, DEFAULT_MONTHLY_QUOTA);

  // 归属条件: 认 isSystem, 也认新/历史命名(与 /api/me/usage 共用 systemKeyWhere)
  assert.deepEqual(calls.lastWhere, {
    where: {
      userId: 42,
      status: 'ACTIVE',
      deletedAt: null,
      OR: [{ isSystem: true }, { name: { in: [SSO_KEY_NAME, ...LEGACY_SSO_KEY_NAMES] } }]
    },
    orderBy: { id: 'desc' }
  });
  assert.equal(calls.create, 1);
  assert.equal(calls.update, 0);
  assert.equal(calls.lastCreate.data.userId, 42);
  assert.equal(calls.lastCreate.data.name, SSO_KEY_NAME);
  assert.equal(calls.lastCreate.data.isSystem, true);
  assert.equal(calls.lastCreate.data.rateLimit, DEFAULT_RATE_LIMIT);
  assert.equal(calls.lastCreate.data.dailyQuota, DEFAULT_DAILY_QUOTA);
  assert.equal(calls.lastCreate.data.monthlyQuota, DEFAULT_MONTHLY_QUOTA);
  assert.ok(bcrypt.compareSync(result.key, calls.lastCreate.data.keyHash), 'keyHash 应可校验明文 key');
  assert.equal(decrypt(calls.lastCreate.data.keyEncrypted, ENCRYPTION_KEY), result.key);
  assert.equal(keyVerifyCache.get('probe-create'), undefined, '创建后应清空 key 校验缓存');
});

test('ensureUserKey: 已托管且带 keyEncrypted 时复用同一把(created=false, 无写)', async () => {
  const existing: KeyRow = {
    id: 7,
    name: SSO_KEY_NAME,
    isSystem: true,
    keyEncrypted: encrypt('sk-existing-reused', ENCRYPTION_KEY),
    rateLimit: 12,
    dailyQuota: 34,
    monthlyQuota: 56
  };
  const { prisma, calls } = fakePrisma(existing);
  keyVerifyCache.set('probe-reuse', { valid: false, reason: 'keep' });

  const result = await ensureUserKey(prisma, 42);

  assert.equal(result.key, 'sk-existing-reused');
  assert.equal(result.keyId, 7);
  assert.equal(result.created, false);
  assert.equal(result.rotated, false);
  assert.equal(result.rateLimit, 12);
  assert.equal(result.dailyQuota, 34);
  assert.equal(result.monthlyQuota, 56);
  assert.equal(calls.create, 0);
  assert.equal(calls.update, 0);
  assert.notEqual(
    keyVerifyCache.get('probe-reuse'),
    undefined,
    '复用路径未变更密钥材料, 不应清空 key 校验缓存'
  );
});

test('ensureUserKey: isSystem 行被改名后仍复用(原地改回默认名, 不发新 key)', async () => {
  const encrypted = encrypt('sk-renamed-system', ENCRYPTION_KEY);
  const existing: KeyRow = {
    id: 8,
    name: 'rename-by-user',
    isSystem: true,
    keyEncrypted: encrypted,
    rateLimit: 20,
    dailyQuota: 30,
    monthlyQuota: 40
  };
  const { prisma, calls } = fakePrisma(existing);
  keyVerifyCache.set('probe-renamed', { valid: false, reason: 'keep' });

  const result = await ensureUserKey(prisma, 42);

  assert.equal(result.key, 'sk-renamed-system');
  assert.equal(result.keyId, 8);
  assert.equal(result.created, false);
  assert.equal(result.rotated, false);
  assert.equal(result.rateLimit, 20);
  assert.equal(result.dailyQuota, 30);
  assert.equal(result.monthlyQuota, 40);
  assert.equal(calls.create, 0);
  assert.equal(calls.update, 1);
  assert.deepEqual(calls.lastUpdate, {
    where: { id: 8 },
    data: { name: SSO_KEY_NAME, isSystem: true }
  });
  assert.equal(existing.keyEncrypted, encrypted, '改名不得触碰 keyEncrypted');
  assert.notEqual(
    keyVerifyCache.get('probe-renamed'),
    undefined,
    '改名/补标记不轮换密钥材料, 不应清空 key 校验缓存'
  );
});

test('ensureUserKey: 历史 sso 行原地改名+标记系统托管(keyEncrypted 与额度不变, 不轮换)', async () => {
  const encrypted = encrypt('sk-legacy-kept', ENCRYPTION_KEY);
  const existing: KeyRow = {
    id: 9,
    name: 'sso',
    isSystem: false,
    keyEncrypted: encrypted,
    rateLimit: 5,
    dailyQuota: 10,
    monthlyQuota: 20
  };
  const { prisma, calls } = fakePrisma(existing);
  keyVerifyCache.set('probe-legacy-keep', { valid: false, reason: 'keep' });

  const result = await ensureUserKey(prisma, 42);

  assert.equal(result.key, 'sk-legacy-kept');
  assert.equal(result.keyId, 9);
  assert.equal(result.created, false);
  assert.equal(result.rotated, false, '有 keyEncrypted 的历史行只改名/标记, 绝不轮换');
  assert.equal(result.rateLimit, 5);
  assert.equal(result.dailyQuota, 10);
  assert.equal(result.monthlyQuota, 20);
  assert.equal(calls.create, 0);
  assert.equal(calls.update, 1);
  assert.deepEqual(calls.lastUpdate, {
    where: { id: 9 },
    data: { name: SSO_KEY_NAME, isSystem: true }
  });
  assert.equal(existing.keyEncrypted, encrypted, 'keyEncrypted 必须原样保留');
  assert.equal(existing.name, SSO_KEY_NAME);
  assert.equal(existing.isSystem, true);
  assert.notEqual(
    keyVerifyCache.get('probe-legacy-keep'),
    undefined,
    '改名/补标记不轮换密钥材料, 不应清空 key 校验缓存'
  );
});

test('ensureUserKey: 历史 key 缺 keyEncrypted 时同一行轮换并补系统标记(rotated=true)', async () => {
  const existing: KeyRow = {
    id: 9,
    name: 'sso',
    isSystem: false,
    keyEncrypted: null,
    rateLimit: 5,
    dailyQuota: 10,
    monthlyQuota: 20
  };
  const { prisma, calls } = fakePrisma(existing);
  keyVerifyCache.set('probe-rotate', { valid: false, reason: 'stale' });

  const result = await ensureUserKey(prisma, 42);

  assert.equal(result.created, false);
  assert.equal(result.rotated, true);
  assert.equal(result.keyId, 9);
  assert.match(result.key, /^sk-[0-9a-f]{64}$/);
  assert.equal(result.rateLimit, 5);
  assert.equal(result.dailyQuota, 10);
  assert.equal(result.monthlyQuota, 20);

  assert.equal(calls.create, 0);
  assert.equal(calls.update, 1);
  assert.deepEqual(calls.lastUpdate.where, { id: 9 });
  assert.deepEqual(Object.keys(calls.lastUpdate.data).sort(), ['isSystem', 'keyEncrypted', 'keyHash', 'name']);
  assert.equal(calls.lastUpdate.data.name, SSO_KEY_NAME);
  assert.equal(calls.lastUpdate.data.isSystem, true);
  assert.ok(bcrypt.compareSync(result.key, calls.lastUpdate.data.keyHash), '轮换后 keyHash 应校验新 key');
  assert.equal(decrypt(calls.lastUpdate.data.keyEncrypted, ENCRYPTION_KEY), result.key);
  assert.equal(keyVerifyCache.get('probe-rotate'), undefined, '轮换后应清空 key 校验缓存');
});
