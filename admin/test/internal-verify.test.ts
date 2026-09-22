import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { internalRoutes } from '../src/routes/internal.js';

// /internal/keys/verify 的月度重置路径: Prisma 替身经 fastify.prisma 注入,
// 用真实 bcrypt 校验一把 key。key 明文每个用例唯一, 避开模块级 keyVerifyCache 串扰;
// 替身按 select 裁剪返回字段, 以便暴露「select 漏 employeeId」这类真实缺陷。
const SECRET = 'test-internal-secret';

before(() => {
  process.env.INTERNAL_SECRET = SECRET;
});

after(() => {
  delete process.env.INTERNAL_SECRET;
});

interface FakeUser {
  id: number;
  employeeId: string | null;
  balance: number;
  balanceResetAt: Date | null;
}

interface BuildOptions {
  user: FakeUser;
  apiKey: string;
  /// 模拟并发: 本次 updateMany 命中 0 行(另一个调用已重置), 库内余额同时变为重置后状态
  raceLost?: boolean;
}

async function buildApp(opts: BuildOptions) {
  const user = { ...opts.user };
  const keyHash = bcrypt.hashSync(opts.apiKey, 4);
  const calls = {
    userSelect: null as any,
    userUpdateMany: 0,
    lastUpdateMany: null as any,
    transactionCreate: 0,
    lastTransaction: null as any
  };

  const prisma = {
    apiKey: {
      findMany: async () => [
        {
          id: 7,
          userId: user.id,
          keyHash,
          keyEncrypted: null,
          name: 'sso',
          status: 'ACTIVE',
          rateLimit: 30,
          dailyQuota: 500000n,
          monthlyQuota: 2000000n,
          expiresAt: null,
          deletedAt: null
        }
      ]
    },
    user: {
      // 按 select 返回, 未选中的字段不出现(与 Prisma 一致)
      findUnique: async (args: any) => {
        if (args.select) calls.userSelect = args.select;
        if (args.where.id !== user.id) return null;
        return {
          ...(args.select?.id ? { id: user.id } : {}),
          ...(args.select?.balance ? { balance: user.balance } : {}),
          ...(args.select?.balanceResetAt ? { balanceResetAt: user.balanceResetAt } : {}),
          ...(args.select?.employeeId ? { employeeId: user.employeeId } : {})
        };
      },
      updateMany: async (args: any) => {
        calls.userUpdateMany++;
        calls.lastUpdateMany = args;
        if (args.where.id !== user.id) return { count: 0 };
        if (opts.raceLost) {
          // 模拟并发调用先落库, 本调用命中 0 行
          user.balance = 100;
          user.balanceResetAt = new Date();
          return { count: 0 };
        }
        const lt = args.where.OR?.[1]?.balanceResetAt?.lt;
        const missing = user.balanceResetAt === null;
        const old = lt !== undefined && new Date(user.balanceResetAt!).getTime() < new Date(lt).getTime();
        if (!missing && !old) return { count: 0 };
        user.balance = args.data.balance;
        user.balanceResetAt = args.data.balanceResetAt;
        return { count: 1 };
      }
    },
    transaction: {
      create: async (args: any) => {
        calls.transactionCreate++;
        calls.lastTransaction = args;
        return { id: 1, ...args.data };
      }
    },
    usageRecord: {
      aggregate: async () => ({ _sum: { tokensIn: 5, tokensOut: 6, cachedTokens: 7 } })
    }
  };

  const app = Fastify();
  app.decorate('prisma', prisma as unknown as PrismaClient);
  await app.register(internalRoutes);
  return { app, calls };
}

type BuiltApp = Awaited<ReturnType<typeof buildApp>>;

async function verify(app: BuiltApp['app'], apiKey: string, secret = SECRET) {
  return app.inject({
    method: 'POST',
    url: '/internal/keys/verify',
    headers: { 'x-internal-secret': secret },
    payload: { apiKey }
  });
}

test('internal/keys/verify: 跨月触发余额重置, userBalance 返回重置后的值', async () => {
  const now = new Date();
  const { app, calls } = await buildApp({
    apiKey: 'sk-verify-cross-month',
    user: {
      id: 8,
      employeeId: 'E001',
      balance: 3,
      balanceResetAt: new Date(now.getFullYear(), now.getMonth() - 1, 15)
    }
  });

  const res = await verify(app, 'sk-verify-cross-month');
  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.equal(body.userBalance, 100, '跨月应重置为月度额度(默认 100)');
  assert.equal(calls.userUpdateMany, 1);
  assert.equal(calls.lastUpdateMany.where.id, 8);
  assert.deepEqual(calls.lastUpdateMany.where.OR, [
    { balanceResetAt: null },
    { balanceResetAt: { lt: new Date(now.getFullYear(), now.getMonth(), 1) } }
  ]);
  assert.equal(calls.lastUpdateMany.data.balance, 100);
  assert.equal(calls.transactionCreate, 1);
  assert.equal(calls.lastTransaction.data.type, 'RECHARGE');
  assert.equal(calls.lastTransaction.data.amount, 100);
  assert.equal(calls.lastTransaction.data.balance, 100);
  // C1 契约: verify 查用户必须带 employeeId, 否则 ensureMonthlyBalance 首道门永远提前返回
  assert.deepEqual(calls.userSelect, { id: true, balance: true, balanceResetAt: true, employeeId: true });
  await app.close();
});

test('internal/keys/verify: 同月不触发重置, userBalance 保持原值', async () => {
  const now = new Date();
  const { app, calls } = await buildApp({
    apiKey: 'sk-verify-same-month',
    user: {
      id: 8,
      employeeId: 'E001',
      balance: 42.5,
      balanceResetAt: new Date(now.getFullYear(), now.getMonth(), 1)
    }
  });

  const res = await verify(app, 'sk-verify-same-month');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().userBalance, 42.5);
  assert.equal(calls.userUpdateMany, 0);
  assert.equal(calls.transactionCreate, 0);
  await app.close();
});

test('internal/keys/verify: 并发下 updateMany 未命中时不重复写 RECHARGE, 返回最新余额', async () => {
  const now = new Date();
  const { app, calls } = await buildApp({
    apiKey: 'sk-verify-race-lost',
    raceLost: true,
    user: {
      id: 8,
      employeeId: 'E001',
      balance: 3,
      balanceResetAt: new Date(now.getFullYear(), now.getMonth() - 1, 15)
    }
  });

  const res = await verify(app, 'sk-verify-race-lost');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().userBalance, 100, '应返回并发调用已重置后的余额');
  assert.equal(calls.userUpdateMany, 1);
  assert.equal(calls.transactionCreate, 0, '未命中不得再写流水');
  await app.close();
});
