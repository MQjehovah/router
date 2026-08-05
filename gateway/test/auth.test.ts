import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { authenticate } from '../src/middleware/auth.js';

const app = Fastify();
app.decorateRequest('authData', null);
app.post('/probe', { preHandler: [authenticate] }, async (req) => {
  return { keyId: (req as any).authData.keyId };
});

const admin = Fastify();
admin.post('/internal/keys/verify', async (req, reply) => {
  const { apiKey } = req.body as any;
  if (apiKey === 'valid-key') {
    return { keyId: 1, userId: 1, rateLimit: 60, dailyQuota: 100000, monthlyQuota: 3000000, userBalance: 100 };
  }
  return reply.status(401).send({ error: 'Invalid key' });
});

before(async () => {
  process.env.ADMIN_API_URL = 'http://127.0.0.1:3999';
  await admin.listen({ port: 3999, host: '127.0.0.1' });
});
after(async () => {
  await admin.close();
  await app.close();
});

test('auth: accepts x-api-key header (claude code style)', async () => {
  const res = await app.inject({ method: 'POST', url: '/probe', headers: { 'x-api-key': 'valid-key' }, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().keyId, 1);
});

test('auth: rejects missing both headers', async () => {
  const res = await app.inject({ method: 'POST', url: '/probe', payload: {} });
  assert.equal(res.statusCode, 401);
});

test('auth: Bearer header still works', async () => {
  const res = await app.inject({ method: 'POST', url: '/probe', headers: { authorization: 'Bearer valid-key' }, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().keyId, 1);
});
