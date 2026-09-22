import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Fastify from 'fastify';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { PrismaClient } from '@prisma/client';
import { createAuthenticateSso, requireSsoUser } from '../src/sso-auth.js';

// 本地起一个最小 IdP: 提供 discovery 与 JWKS, 用真实 RS256 私钥签发 router token,
// 端到端走通 verifySsoToken(签名/iss/aud/exp) + authenticateSso 的真实分支,
// 只把 prisma.user.findUnique 换成内存替身(工号映射)。
const KID = 'test-key-1';

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
  const port = (idpServer.address() as { port: number }).port;
  issuer = `http://127.0.0.1:${port}`;

  process.env.OIDC_ISSUER = issuer;
  process.env.SSO_ROUTER_AUDIENCE = 'router';
});

after(async () => {
  delete process.env.OIDC_ISSUER;
  delete process.env.SSO_ROUTER_AUDIENCE;
  await new Promise<void>((resolve) => idpServer.close(() => resolve()));
});

interface SignOptions {
  /// 显式传 null 时不带 sub(覆盖「有效签名但无工号」分支)
  employeeId?: string | null;
  audience?: string;
  expiresIn?: string;
}

async function signRouterToken(opts: SignOptions = {}): Promise<string> {
  const jwt = new SignJWT({ name: '张三' })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(issuer)
    .setAudience(opts.audience ?? 'router')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h');
  if (opts.employeeId !== null) {
    jwt.setSubject(opts.employeeId ?? 'E001');
  }
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

function buildApp(user: FakeUser | null, opts: { failDb?: boolean } = {}) {
  const calls = { findUnique: 0, lastArgs: null as any };
  const prisma = {
    user: {
      findUnique: async (args: any) => {
        calls.findUnique++;
        calls.lastArgs = args;
        if (opts.failDb) throw new Error('db down');
        return user && args.where.employeeId === user.employeeId ? user : null;
      }
    }
  };

  const app = Fastify();
  app.decorate('authenticateSso', createAuthenticateSso(prisma as unknown as PrismaClient));
  app.get('/api/me', { preHandler: [app.authenticateSso] }, async (req) => {
    const ssoUser = requireSsoUser(req);
    return {
      id: ssoUser.id,
      employeeId: ssoUser.employeeId,
      name: ssoUser.name,
      email: ssoUser.email,
      role: ssoUser.role
    };
  });
  return { app, calls };
}

async function injectMe(app: ReturnType<typeof buildApp>['app'], authorization?: string) {
  return app.inject({
    method: 'GET',
    url: '/api/me',
    headers: authorization ? { authorization } : {}
  });
}

const USER: FakeUser = {
  id: 8,
  employeeId: 'E001',
  name: '张三',
  email: 'zhangsan@example.com',
  role: 'USER',
  balance: 100
};

test('authenticateSso: 无 Authorization 头返回 401', async () => {
  const { app } = buildApp(null);
  const res = await injectMe(app);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), { error: 'Unauthorized' });
  await app.close();
});

test('authenticateSso: 非 Bearer 方案返回 401', async () => {
  const { app } = buildApp(null);
  const token = await signRouterToken();
  const res = await injectMe(app, token);
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('authenticateSso: 非法 token 返回 401', async () => {
  const { app } = buildApp(null);
  const res = await injectMe(app, 'Bearer not-a-jwt');
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('authenticateSso: aud 不符的 token 返回 401', async () => {
  const { app, calls } = buildApp(USER);
  const token = await signRouterToken({ audience: 'other-service' });
  const res = await injectMe(app, `Bearer ${token}`);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.findUnique, 0, '验签失败不应查库');
  await app.close();
});

test('authenticateSso: 过期 token 返回 401', async () => {
  const { app } = buildApp(USER);
  const token = await signRouterToken({ expiresIn: '-2m' });
  const res = await injectMe(app, `Bearer ${token}`);
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('authenticateSso: 有效签名但无工号返回 403 且不查库', async () => {
  const { app, calls } = buildApp(USER);
  const token = await signRouterToken({ employeeId: null });
  const res = await injectMe(app, `Bearer ${token}`);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: 'Forbidden' });
  assert.equal(calls.findUnique, 0, '无工号不应查库');
  await app.close();
});

test('authenticateSso: 未知工号返回 403(用户未开通)', async () => {
  const { app, calls } = buildApp(null);
  const token = await signRouterToken({ employeeId: 'E404' });
  const res = await injectMe(app, `Bearer ${token}`);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: 'Forbidden', detail: '用户未开通' });
  assert.equal(calls.findUnique, 1);
  assert.deepEqual(calls.lastArgs.where, { employeeId: 'E404' });
  await app.close();
});

test('authenticateSso: 有效 token 挂载 req.ssoUser 并放行(最小字段契约)', async () => {
  const { app, calls } = buildApp(USER);
  const token = await signRouterToken({ employeeId: 'E001' });
  const res = await injectMe(app, `Bearer ${token}`);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    id: 8,
    employeeId: 'E001',
    name: '张三',
    email: 'zhangsan@example.com',
    role: 'USER'
  });
  // 查询条件与 select 契约: 只取 id/employeeId/name/email/role/balance, 绝不带 passwordHash
  assert.deepEqual(calls.lastArgs, {
    where: { employeeId: 'E001' },
    select: { id: true, employeeId: true, name: true, email: true, role: true, balance: true }
  });
  assert.ok(!('passwordHash' in calls.lastArgs.select), 'select 不得包含 passwordHash');
  await app.close();
});

test('authenticateSso: scheme 大小写不敏感(bearer 小写放行)', async () => {
  const { app } = buildApp(USER);
  const token = await signRouterToken();
  const res = await injectMe(app, `bearer ${token}`);
  assert.equal(res.statusCode, 200);
  await app.close();
});

test('authenticateSso: SSO_ROUTER_AUDIENCE 自定义受众生效', async () => {
  const saved = process.env.SSO_ROUTER_AUDIENCE;
  process.env.SSO_ROUTER_AUDIENCE = 'router-test';
  try {
    const ok = buildApp(USER);
    const okRes = await injectMe(ok.app, `Bearer ${await signRouterToken({ audience: 'router-test' })}`);
    assert.equal(okRes.statusCode, 200);
    await ok.app.close();

    const bad = buildApp(USER);
    const badRes = await injectMe(bad.app, `Bearer ${await signRouterToken({ audience: 'router' })}`);
    assert.equal(badRes.statusCode, 401);
    await bad.app.close();
  } finally {
    if (saved !== undefined) process.env.SSO_ROUTER_AUDIENCE = saved;
  }
});

test('authenticateSso: 查库异常返回 500(不是 401)', async () => {
  const { app } = buildApp(USER, { failDb: true });
  const token = await signRouterToken();
  const res = await injectMe(app, `Bearer ${token}`);
  assert.equal(res.statusCode, 500);
  await app.close();
});

test('authenticateSso: OIDC 未配置返回 500(不是 401) 且不查库', async () => {
  const saved = process.env.OIDC_ISSUER;
  delete process.env.OIDC_ISSUER;
  try {
    const { app, calls } = buildApp(USER);
    const res = await injectMe(app, 'Bearer dummy-token');
    assert.equal(res.statusCode, 500);
    assert.equal(calls.findUnique, 0);
    await app.close();
  } finally {
    if (saved !== undefined) process.env.OIDC_ISSUER = saved;
  }
});

test('requireSsoUser: 未挂载 authenticateSso 时抛错(Fastify 500)', async () => {
  const app = Fastify();
  app.get('/api/me', async (req) => ({ id: requireSsoUser(req).id }));
  const res = await app.inject({ method: 'GET', url: '/api/me' });
  assert.equal(res.statusCode, 500);
  assert.match(res.json().message, /ssoUser/);
  await app.close();
});
