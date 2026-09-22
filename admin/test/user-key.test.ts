import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from '../src/crypto-utils.js';
import { encryptionKey } from '../src/env.js';
import { keyVerifyCache } from '../src/key-cache.js';
import { ensureUserKey, SSO_KEY_NAME } from '../src/services/user-key.js';

const ENCRYPTION_KEY = encryptionKey();

interface KeyRow {
  id: number;
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
        return { id: args.where.id };
      }
    }
  };
  return { prisma: prisma as unknown as PrismaClient, calls };
}

test('ensureUserKey: 无 key 时创建新 key(created=true, sk- 前缀, 落默认/传入额度)', async () => {
  const { prisma, calls } = fakePrisma(null);
  keyVerifyCache.set('probe-create', { valid: false, reason: 'stale' });

  const result = await ensureUserKey(prisma, 42, { rateLimit: 30, dailyQuota: 500, monthlyQuota: 900 });

  assert.equal(result.created, true);
  assert.equal(result.rotated, false);
  assert.match(result.key, /^sk-[0-9a-f]{64}$/);
  assert.equal(result.keyId, 101);
  assert.equal(result.rateLimit, 30);
  assert.equal(result.dailyQuota, 500);
  assert.equal(result.monthlyQuota, 900);

  assert.deepEqual(calls.lastWhere, {
    where: { userId: 42, name: SSO_KEY_NAME, status: 'ACTIVE', deletedAt: null },
    orderBy: { id: 'desc' }
  });
  assert.equal(calls.create, 1);
  assert.equal(calls.update, 0);
  assert.equal(calls.lastCreate.data.userId, 42);
  assert.equal(calls.lastCreate.data.name, SSO_KEY_NAME);
  assert.equal(calls.lastCreate.data.rateLimit, 30);
  assert.equal(calls.lastCreate.data.dailyQuota, 500);
  assert.equal(calls.lastCreate.data.monthlyQuota, 900);
  assert.ok(bcrypt.compareSync(result.key, calls.lastCreate.data.keyHash), 'keyHash 应可校验明文 key');
  assert.equal(decrypt(calls.lastCreate.data.keyEncrypted, ENCRYPTION_KEY), result.key);
  assert.equal(keyVerifyCache.get('probe-create'), undefined, '创建后应清空 key 校验缓存');
});

test('ensureUserKey: 无 key 且不传额度时用默认值(60/100000/3000000)', async () => {
  const { prisma, calls } = fakePrisma(null);

  const result = await ensureUserKey(prisma, 7);

  assert.equal(result.rateLimit, 60);
  assert.equal(result.dailyQuota, 100000);
  assert.equal(result.monthlyQuota, 3000000);
  assert.equal(calls.lastCreate.data.rateLimit, 60);
  assert.equal(calls.lastCreate.data.dailyQuota, 100000);
  assert.equal(calls.lastCreate.data.monthlyQuota, 3000000);
});

test('ensureUserKey: 已有 keyEncrypted 时复用同一把(created=false, 无新行)', async () => {
  const existing: KeyRow = {
    id: 7,
    keyEncrypted: encrypt('sk-existing-reused', ENCRYPTION_KEY),
    rateLimit: 12,
    dailyQuota: 34,
    monthlyQuota: 56
  };
  const { prisma, calls } = fakePrisma(existing);

  const result = await ensureUserKey(prisma, 42, { rateLimit: 999 });

  assert.equal(result.key, 'sk-existing-reused');
  assert.equal(result.keyId, 7);
  assert.equal(result.created, false);
  assert.equal(result.rotated, false);
  assert.equal(result.rateLimit, 12);
  assert.equal(result.dailyQuota, 34);
  assert.equal(result.monthlyQuota, 56);
  assert.equal(calls.create, 0);
  assert.equal(calls.update, 0);
});

test('ensureUserKey: 历史 key 缺 keyEncrypted 时同一行轮换(rotated=true)', async () => {
  const existing: KeyRow = {
    id: 9,
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
  assert.ok(Object.keys(calls.lastUpdate.data).sort().join(',') === 'keyEncrypted,keyHash');
  assert.ok(bcrypt.compareSync(result.key, calls.lastUpdate.data.keyHash), '轮换后 keyHash 应校验新 key');
  assert.equal(decrypt(calls.lastUpdate.data.keyEncrypted, ENCRYPTION_KEY), result.key);
  assert.equal(keyVerifyCache.get('probe-rotate'), undefined, '轮换后应清空 key 校验缓存');
});
