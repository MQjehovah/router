import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Fastify from 'fastify';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { PrismaClient } from '@prisma/client';
import { createAuthenticateSso } from '../src/sso-auth.js';
import { meRoutes } from '../src/routes/me.js';

// 同 me-auth.test.ts: 本地最小 IdP + 真实 RS256 验签, 只把 Prisma 换成内存替身,
// 端到端覆盖 /api/me/usage 的鉴权分支与聚合语义。
const KID = 'me-usage-key-1';

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

async function signRouterToken(opts: { employeeId?: string; audience?: string } = {}): Promise<string> {
  const jwt = new SignJWT({ name: '张三' })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(issuer)
    .setAudience(opts.audience ?? 'router')
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

interface FakeKey {
  id: number;
  userId: number;
  name: string;
  status: string;
  deletedAt: Date | null;
  rateLimit: number;
  dailyQuota: bigint;
  monthlyQuota: bigint;
}

const KEY: FakeKey = {
  id: 7,
  userId: USER.id,
  name: 'sso',
  status: 'ACTIVE',
  deletedAt: null,
  rateLimit: 30,
  dailyQuota: 500000n,
  monthlyQuota: 2000000n
};

interface FakeUsageRow {
  apiKeyId: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  createdAt: Date;
}

interface FakeModel {
  id: number;
  name: string;
  status: string;
  providerId: number;
  provider: { id: number; name: string; status: string };
}

interface FakeGrant {
  apiKeyId: number;
  modelId: number;
  dailyQuota: bigint;
  monthlyQuota: bigint;
  model: FakeModel;
}

function makeModel(id: number, name: string, opts: { modelStatus?: string; providerStatus?: string } = {}): FakeModel {
  return {
    id,
    name,
    status: opts.modelStatus ?? 'ACTIVE',
    providerId: 1,
    provider: { id: 1, name: 'provider-1', status: opts.providerStatus ?? 'ACTIVE' }
  };
}

function makeGrant(model: FakeModel, dailyQuota = 5000n, monthlyQuota = 50000n): FakeGrant {
  return { apiKeyId: KEY.id, modelId: model.id, dailyQuota, monthlyQuota, model };
}

interface BuildOptions {
  user?: FakeUser | null;
  key?: FakeKey | null;
  usage?: FakeUsageRow[];
  grants?: FakeGrant[];
  models?: FakeModel[];
}

async function buildApp(opts: BuildOptions = {}) {
  const user = opts.user === undefined ? USER : opts.user;
  const key = opts.key === undefined ? null : opts.key;
  const usage = opts.usage ?? [];
  const grants = opts.grants ?? [];
  const models = opts.models ?? [];

  const calls = {
    writes: 0,
    userFindUnique: 0,
    keyFindFirst: 0,
    keyWhere: null as any,
    aggregates: [] as any[],
    groupBys: [] as any[],
    modelFindMany: 0
  };

  const sumRows = (rows: FakeUsageRow[]) => ({
    tokensIn: rows.reduce((s, r) => s + r.tokensIn, 0),
    tokensOut: rows.reduce((s, r) => s + r.tokensOut, 0),
    cost: rows.reduce((s, r) => s + r.cost, 0)
  });

  const pickRows = (where: any) =>
    usage.filter(
      (r) =>
        r.apiKeyId === where.apiKeyId &&
        (where.model === undefined || r.model === where.model) &&
        r.createdAt.getTime() >= new Date(where.createdAt.gte).getTime()
    );

  const prisma = {
    user: {
      findUnique: async (args: any) => {
        calls.userFindUnique++;
        return user && args.where.employeeId === user.employeeId ? user : null;
      }
    },
    apiKey: {
      findFirst: async (args: any) => {
        calls.keyFindFirst++;
        calls.keyWhere = args;
        return key;
      },
      create: async () => {
        calls.writes++;
        throw new Error('me/usage 不得创建 key');
      },
      update: async () => {
        calls.writes++;
        throw new Error('me/usage 不得更新 key');
      },
      delete: async () => {
        calls.writes++;
        throw new Error('me/usage 不得删除 key');
      }
    },
    usageRecord: {
      aggregate: async (args: any) => {
        calls.aggregates.push(args.where);
        return { _sum: sumRows(pickRows(args.where)) };
      },
      groupBy: async (args: any) => {
        calls.groupBys.push(args);
        const byModel = new Map<string, FakeUsageRow[]>();
        for (const row of pickRows(args.where)) {
          const list = byModel.get(row.model) ?? [];
          list.push(row);
          byModel.set(row.model, list);
        }
        return [...byModel.entries()].map(([model, rows]) => ({ model, _sum: sumRows(rows) }));
      }
    },
    apiKeyAllowedModel: {
      findMany: async (args: any) => grants.filter((g) => g.apiKeyId === args.where.apiKeyId)
    },
    model: {
      findMany: async () => {
        calls.modelFindMany++;
        return models;
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

async function injectUsage(app: BuiltApp['app'], authorization?: string) {
  return app.inject({
    method: 'GET',
    url: '/api/me/usage',
    headers: authorization ? { authorization } : {}
  });
}

function todayStartOf(at: Date): Date {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthStartOf(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), 1);
}

const ZERO_BUCKET = { tokensIn: 0, tokensOut: 0, tokens: 0, cost: 0 };

test('GET /api/me/usage: 有效 token 返回摘要(模式/值域/模型只取授权 ACTIVE)', async () => {
  const at = new Date();
  const granted = makeModel(11, 'gpt-4o');
  const revoked = makeModel(12, 'gpt-4o-mini', { modelStatus: 'INACTIVE' });
  const { app, calls } = await buildApp({
    key: KEY,
    grants: [makeGrant(granted, 5000n, 50000n), makeGrant(revoked, 111n, 222n)],
    usage: [
      { apiKeyId: KEY.id, model: 'gpt-4o', tokensIn: 100, tokensOut: 40, cost: 1, createdAt: at },
      { apiKeyId: KEY.id, model: 'gpt-4o', tokensIn: 10, tokensOut: 5, cost: 2, createdAt: at }
    ]
  });

  const res = await injectUsage(app, `Bearer ${await signRouterToken()}`);
  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.equal(body.balance, 88.5, 'balance 来自 User.balance');
  assert.equal(body.rateLimit, 30, 'rateLimit 来自该用户 sso key');
  assert.deepEqual(body.quota, { daily: 500000, monthly: 2000000 });
  // tokens = tokensIn + tokensOut; cost 为聚合和
  assert.deepEqual(body.today, { tokensIn: 110, tokensOut: 45, tokens: 155, cost: 3 });
  assert.deepEqual(body.month, { tokensIn: 110, tokensOut: 45, tokens: 155, cost: 3 });
  assert.deepEqual(body.models, [
    {
      name: 'gpt-4o',
      today: { tokensIn: 110, tokensOut: 45, tokens: 155, cost: 3 },
      month: { tokensIn: 110, tokensOut: 45, tokens: 155, cost: 3 },
      dailyQuota: 5000,
      monthlyQuota: 50000
    }
  ]);
  assert.equal(body.truncated, false);
  assert.ok(!Number.isNaN(Date.parse(body.fetchedAt)), 'fetchedAt 应是服务端 ISO 时间');

  // 归属范围: 查找条件与 ensureUserKey 对齐; 只读, 无任何写操作
  assert.deepEqual(calls.keyWhere, {
    where: { userId: USER.id, name: 'sso', status: 'ACTIVE', deletedAt: null },
    orderBy: { id: 'desc' }
  });
  assert.equal(calls.writes, 0);
  // 查询有界: 总量 2 次聚合 + 每模型分解 2 次 groupBy(不随模型数增长)
  assert.equal(calls.aggregates.length, 2);
  assert.equal(calls.aggregates[0].apiKeyId, KEY.id);
  assert.equal(calls.aggregates[0].createdAt.gte.getTime(), todayStartOf(at).getTime());
  assert.equal(calls.aggregates[1].createdAt.gte.getTime(), monthStartOf(at).getTime());
  assert.equal(calls.groupBys.length, 2);
  assert.deepEqual(calls.groupBys[0].by, ['model']);
  assert.equal(calls.groupBys[0].where.apiKeyId, KEY.id);

  await app.close();
});

test('GET /api/me/usage: 无 token 返回 401 且不查用量', async () => {
  const { app, calls } = await buildApp({ key: KEY });
  const res = await injectUsage(app);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), { error: 'Unauthorized' });
  assert.equal(calls.userFindUnique, 0);
  assert.equal(calls.keyFindFirst, 0);
  assert.equal(calls.aggregates.length, 0);
  await app.close();
});

test('GET /api/me/usage: aud 不符的 token 返回 401 且不查用量', async () => {
  const { app, calls } = await buildApp({ key: KEY });
  const token = await signRouterToken({ audience: 'other-service' });
  const res = await injectUsage(app, `Bearer ${token}`);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.userFindUnique, 0);
  assert.equal(calls.keyFindFirst, 0);
  await app.close();
});

test('GET /api/me/usage: 工号未知返回 403(用户未开通)', async () => {
  const { app, calls } = await buildApp({ user: null, key: KEY });
  const token = await signRouterToken({ employeeId: 'E404' });
  const res = await injectUsage(app, `Bearer ${token}`);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: 'Forbidden', detail: '用户未开通' });
  assert.equal(calls.keyFindFirst, 0, '鉴权失败不应查用量');
  await app.close();
});

test('GET /api/me/usage: 无 sso key 返回全 0 + 默认 quota, 且不产生写操作', async () => {
  const { app, calls } = await buildApp({ key: null });
  const res = await injectUsage(app, `Bearer ${await signRouterToken()}`);
  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.equal(body.balance, 88.5, 'balance 仍来自 User');
  assert.equal(body.rateLimit, 60);
  assert.deepEqual(body.quota, { daily: 100000, monthly: 3000000 });
  assert.deepEqual(body.today, ZERO_BUCKET);
  assert.deepEqual(body.month, ZERO_BUCKET);
  assert.deepEqual(body.models, []);
  assert.equal(body.truncated, false);

  assert.equal(calls.keyFindFirst, 1);
  assert.deepEqual(calls.keyWhere.where, { userId: USER.id, name: 'sso', status: 'ACTIVE', deletedAt: null });
  assert.equal(calls.aggregates.length, 0);
  assert.equal(calls.writes, 0, '无 key 时只读, 绝不创建/轮换');
  await app.close();
});

test('GET /api/me/usage: 模型清单超过 10 个时截断并置 truncated', async () => {
  const models = Array.from({ length: 12 }, (_, i) => makeModel(i + 1, `model-${i + 1}`));
  const { app, calls } = await buildApp({
    key: KEY,
    models,
    usage: [{ apiKeyId: KEY.id, model: 'model-1', tokensIn: 100, tokensOut: 0, cost: 1, createdAt: new Date() }]
  });

  const res = await injectUsage(app, `Bearer ${await signRouterToken()}`);
  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.equal(body.truncated, true);
  assert.equal(body.models.length, 10);
  assert.equal(body.models[0].name, 'model-1');
  assert.equal(body.models[9].name, 'model-10');
  // 无授权时模型用量/配额无归属(internal verify 仅在有授权时计算), 故仍为 0
  assert.deepEqual(body.models[0].today, ZERO_BUCKET);
  assert.deepEqual(body.models[0].month, ZERO_BUCKET);
  assert.equal(body.models[0].dailyQuota, 0);
  assert.equal(body.models[0].monthlyQuota, 0);
  // 总量仍按 key 聚合
  assert.equal(body.today.tokens, 100);
  assert.equal(calls.modelFindMany, 1);
  assert.equal(calls.groupBys.length, 0, '无授权时不做按模型聚合');
  await app.close();
});
