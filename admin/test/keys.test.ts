import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { keyRoutes } from '../src/routes/keys.js';
import { SSO_KEY_NAME } from '../src/services/user-key.js';

// DELETE /api/keys/:id 的系统托管保护: Prisma 经 fastify.prisma 注入内存替身,
// authenticate 装饰器换成固定用户, 端到端覆盖 409 保护 / 管理员放行 / 普通密钥不受影响。

interface FakeUser {
  id: number;
  email: string;
  role: 'ADMIN' | 'USER';
}

interface FakeKeyRow {
  id: number;
  userId: number;
  name: string;
  isSystem: boolean;
  status: string;
  deletedAt: Date | null;
}

function makeKey(overrides: Partial<FakeKeyRow> = {}): FakeKeyRow {
  return {
    id: 5,
    userId: 8,
    name: SSO_KEY_NAME,
    isSystem: true,
    status: 'ACTIVE',
    deletedAt: null,
    ...overrides
  };
}

function buildApp(user: FakeUser, keys: FakeKeyRow[]) {
  const calls = {
    updates: [] as any[],
    audits: [] as any[]
  };

  const prisma = {
    apiKey: {
      findFirst: async (args: any) => {
        const { where } = args;
        return keys.find((k) => k.id === where.id && k.deletedAt === where.deletedAt) ?? null;
      },
      update: async (args: any) => {
        calls.updates.push(args);
        const row = keys.find((k) => k.id === args.where.id)!;
        Object.assign(row, args.data);
        return row;
      }
    },
    auditLog: {
      create: async (args: any) => {
        calls.audits.push(args);
        return { id: 1, ...args.data };
      }
    }
  };

  const app = Fastify();
  app.decorate('prisma', prisma as unknown as PrismaClient);
  app.decorate('authenticate', async (req: any) => {
    req.user = user;
  });

  return app.register(keyRoutes).then(() => ({ app, calls }));
}

const USER: FakeUser = { id: 8, email: 'user@example.com', role: 'USER' };
const ADMIN: FakeUser = { id: 1, email: 'admin@example.com', role: 'ADMIN' };

test('DELETE /api/keys/:id: 普通用户删自己的系统托管 key 返回 409 且不删除', async () => {
  const key = makeKey();
  const { app, calls } = await buildApp(USER, [key]);

  const res = await app.inject({ method: 'DELETE', url: `/api/keys/${key.id}` });

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.json(), {
    error: '系统托管密钥不可删除（工作台自动使用）；如需更换请使用“重新生成”'
  });
  assert.equal(key.deletedAt, null, '系统托管 key 不得被逻辑删除');
  assert.equal(key.status, 'ACTIVE');
  assert.equal(calls.updates.length, 0, '409 不应写库');
  assert.equal(calls.audits.length, 0, '409 不应写审计');
  await app.close();
});

test('DELETE /api/keys/:id: ADMIN 可删系统托管 key(逻辑删除 + 审计照常)', async () => {
  const key = makeKey();
  const { app, calls } = await buildApp(ADMIN, [key]);

  const res = await app.inject({ method: 'DELETE', url: `/api/keys/${key.id}` });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { success: true, deleted: true });
  assert.ok(key.deletedAt instanceof Date, '应置 deletedAt 逻辑删除');
  assert.equal(key.status, 'INACTIVE', '应同步置 INACTIVE 双保险');
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.updates[0].where, { id: key.id });
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].data.action, 'delete');
  assert.equal(calls.audits[0].data.targetType, 'key');
  assert.equal(calls.audits[0].data.targetId, String(key.id));
  assert.equal(calls.audits[0].data.userId, ADMIN.id);
  await app.close();
});

test('DELETE /api/keys/:id: 普通用户删自己的普通 key 仍可逻辑删除', async () => {
  const key = makeKey({ name: 'console', isSystem: false });
  const { app, calls } = await buildApp(USER, [key]);

  const res = await app.inject({ method: 'DELETE', url: `/api/keys/${key.id}` });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { success: true, deleted: true });
  assert.ok(key.deletedAt instanceof Date);
  assert.equal(key.status, 'INACTIVE');
  assert.equal(calls.audits.length, 1);
  await app.close();
});

test('DELETE /api/keys/:id: 普通用户删他人的系统托管 key 先按 403 拒绝', async () => {
  const key = makeKey({ userId: 999 });
  const { app, calls } = await buildApp(USER, [key]);

  const res = await app.inject({ method: 'DELETE', url: `/api/keys/${key.id}` });

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: 'Forbidden' });
  assert.equal(key.deletedAt, null);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.audits.length, 0);
  await app.close();
});
