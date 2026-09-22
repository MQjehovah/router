import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Fastify from 'fastify';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { PrismaClient } from '@prisma/client';
import { createAuthenticateSso } from '../src/sso-auth.js';

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
  employeeId?: string;
  audience?: string;
  expiresIn?: string;
}

async function signRouterToken(opts: SignOptions = {}): Promise<string> {
  return new SignJWT({ name: '张三' })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(issuer)
    .setAudience(opts.audience ?? 'router')
    .setSubject(opts.employeeId ?? 'E001')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h')
    .sign(privateKey);
}

interface FakeUser {
  id: number;
  employeeId: string;
  name: string;
}

function buildApp(user: FakeUser | null) {
  const calls = { findUnique: 0, lastEmployeeId: null as string | null };
  const prisma = {
    user: {
      findUnique: async (args: { where: { employeeId: string } }) => {
        calls.findUnique++;
        calls.lastEmployeeId = args.where.employeeId;
        return user && args.where.employeeId === user.employeeId ? user : null;
      }
    }
  };

  const app = Fastify();
  app.decorate('authenticateSso', createAuthenticateSso(prisma as unknown as PrismaClient));
  app.get('/api/me', { preHandler: [app.authenticateSso] }, async (req: any) => ({
    userId: req.ssoUser.id,
    employeeId: req.ssoUser.employeeId
  }));
  return { app, calls };
}

async function injectMe(app: ReturnType<typeof buildApp>['app'], authorization?: string) {
  return app.inject({
    method: 'GET',
    url: '/api/me',
    headers: authorization ? { authorization } : {}
  });
}

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
  const { app, calls } = buildApp({ id: 1, employeeId: 'E001', name: '张三' });
  const token = await signRouterToken({ audience: 'other-service' });
  const res = await injectMe(app, `Bearer ${token}`);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.findUnique, 0, '验签失败不应查库');
  await app.close();
});

test('authenticateSso: 过期 token 返回 401', async () => {
  const { app } = buildApp({ id: 1, employeeId: 'E001', name: '张三' });
  const token = await signRouterToken({ expiresIn: '-2m' });
  const res = await injectMe(app, `Bearer ${token}`);
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('authenticateSso: 未知工号返回 403(用户未开通)', async () => {
  const { app, calls } = buildApp(null);
  const token = await signRouterToken({ employeeId: 'E404' });
  const res = await injectMe(app, `Bearer ${token}`);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: 'Forbidden', detail: '用户未开通' });
  assert.equal(calls.lastEmployeeId, 'E404');
  await app.close();
});

test('authenticateSso: 有效 token 挂载 req.ssoUser 并放行', async () => {
  const user: FakeUser = { id: 8, employeeId: 'E001', name: '张三' };
  const { app, calls } = buildApp(user);
  const token = await signRouterToken({ employeeId: 'E001' });
  const res = await injectMe(app, `Bearer ${token}`);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { userId: 8, employeeId: 'E001' });
  assert.equal(calls.lastEmployeeId, 'E001');
  await app.close();
});
