import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Fastify from 'fastify';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { PrismaClient } from '@prisma/client';
import { createAuthenticateSso } from '../src/sso-auth.js';
import { meRoutes } from '../src/routes/me.js';

// 同 me-auth.test.ts: 本地最小 IdP + 真实 RS256 验签; Prisma 替身保留最小的 apiKey 内存表,
// 以验证「首次创建 / 再次复用」的幂等语义。
const KID = 'me-key-key-1';

let idpServer: http.Server;
let issuer = '';
let privateKey: CryptoKey;

before(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey as CryptoKey;
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };

  idpServer = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/.well-known/openid-configuration')) {
      res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks.json` }));
      return;
    }
    if (req.url?.startsWith('/jwks.json')) {
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise<void>((resolve) => idpServer.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(idpServer.address() as { port: number }).port}`;

  process.env.OIDC_ISSUER = issuer;
  process.env.SSO_ROUTER_AUDIENCE = 'router';
});

after(async () => {
  delete process.env.OIDC_ISSUER;
  delete process.env.SSO_ROUTER_AUDIENCE;
  await new Promise<void>((resolve) => idpServer.close(() => resolve()));
});

async function signRouterToken(opts: { employeeId?: string } = {}): Promise<string> {
  const jwt = new SignJWT({ name: '张三' })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(issuer)
    .setAudience('router')
    .setIssuedAt()
    .setExpirationTime('1h');
  jwt.setSubject(opts.employeeId ?? 'E001');
  return jwt.sign(privateKey);
}

interface FakeUser {
  id: number;
  employeeId: string;
  name: string;
  email: string | null;
  role: 'ADMIN' | 'USER';
  balance: number;
}

const USER: FakeUser = {
  id: 8,
  employeeId: 'E001',
  name: '张三',
  email: 'zhangsan@example.com',
  role: 'USER',
  balance: 88.5
};

interface FakeKeyRow {
  id: number;
  userId: number;
  name: string;
  status: string;
  deletedAt: Date | null;
  keyEncrypted: string | null;
  keyHash: string;
  rateLimit: number;
  dailyQuota: number;
  monthlyQuota: number;
}

async function buildApp(user: FakeUser | null = USER) {
  const rows: FakeKeyRow[] = [];
  const calls = {
    writes: 0,
    findFirst: 0,
    create: 0,
    lastCreate: null as any
  };

  const prisma = {
    user: {
      findUnique: async (args: any) => (user && args.where.employeeId === user.employeeId ? user : null)
    },
    apiKey: {
      findFirst: async (args: any) => {
        calls.findFirst++;
        const { where } = args;
        const matched = rows
          .filter(
            (r) =>
              r.userId === where.userId &&
              r.name === where.name &&
              r.status === where.status &&
              r.deletedAt === where.deletedAt
          )
          .sort((a, b) => b.id - a.id);
        return matched[0] ?? null;
      },
      create: async (args: any) => {
        calls.create++;
        calls.writes++;
        calls.lastCreate = args;
        const row: FakeKeyRow = {
          id: 101,
          status: 'ACTIVE',
          deletedAt: null,
          ...args.data
        };
        rows.push(row);
        return row;
      },
      update: async (args: any) => {
        calls.writes++;
        const row = rows.find((r) => r.id === args.where.id)!;
        Object.assign(row, args.data);
        return row;
      }
    }
  };

  const app = Fastify();
  app.decorate('authenticateSso', createAuthenticateSso(prisma as unknown as PrismaClient));
  app.decorate('prisma', prisma as unknown as PrismaClient);
  await app.register(meRoutes);
  return { app, calls };
}

type BuiltApp = Awaited<ReturnType<typeof buildApp>>;

async function injectKey(app: BuiltApp['app'], authorization?: string) {
  return app.inject({
    method: 'GET',
    url: '/api/me/key',
    headers: authorization ? { authorization } : {}
  });
}

test('GET /api/me/key: 首次调用创建 sso key(created=true, sk- 前缀)并带用户字段', async () => {
  const { app, calls } = await buildApp();
  const res = await injectKey(app, `Bearer ${await signRouterToken()}`);
  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.equal(body.created, true);
  assert.equal(body.rotated, false);
  assert.equal(body.keyId, 101);
  assert.match(body.key, /^sk-[0-9a-f]{64}$/);
  assert.equal(body.rateLimit, 60);
  assert.equal(body.dailyQuota, 100000);
  assert.equal(body.monthlyQuota, 3000000);
  assert.equal(body.employeeId, 'E001');
  assert.equal(body.name, '张三');
  assert.equal(body.email, 'zhangsan@example.com');

  assert.equal(calls.create, 1);
  assert.equal(calls.lastCreate.data.userId, USER.id);
  assert.equal(calls.lastCreate.data.name, 'sso');
  await app.close();
});

test('GET /api/me/key: 再次调用复用同一把 key(created=false, 不重复建行)', async () => {
  const { app, calls } = await buildApp();
  const auth = `Bearer ${await signRouterToken()}`;

  const first = (await injectKey(app, auth)).json();
  const second = (await injectKey(app, auth)).json();

  assert.equal(second.key, first.key);
  assert.equal(second.keyId, first.keyId);
  assert.equal(second.created, false);
  assert.equal(second.rotated, false);
  assert.equal(calls.create, 1, '已有 key 时不得再建行');
  assert.equal(calls.writes, 1);
  await app.close();
});

test('GET /api/me/key: 无 token 返回 401 且不触碰 key', async () => {
  const { app, calls } = await buildApp();
  const res = await injectKey(app);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.findFirst, 0);
  assert.equal(calls.writes, 0);
  await app.close();
});

test('GET /api/me/key: 未知工号返回 403(用户未开通)', async () => {
  const { app, calls } = await buildApp(null);
  const token = await signRouterToken({ employeeId: 'E404' });
  const res = await injectKey(app, `Bearer ${token}`);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: 'Forbidden', detail: '用户未开通' });
  assert.equal(calls.findFirst, 0);
  assert.equal(calls.writes, 0);
  await app.close();
});
