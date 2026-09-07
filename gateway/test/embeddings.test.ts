import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { buildApp } from '../src/app.js';
import { estimateTokensIn } from '../src/routes/embeddings.js';

const reported: any[] = [];
let admin: Fastify.FastifyInstance;
let gateway: Fastify.FastifyInstance;
let upstream: Fastify.FastifyInstance;

const EMBED_USAGE_CONFIG = {
  model: 'embed-usage', providerType: 'OPENAI',
  baseUrl: 'http://127.0.0.1:4007', path: '/v1/embeddings',
  pricing: { inputPrice: 0.02, outputPrice: 0.1, cachePrice: 0 },
  providerId: 1, authType: 'bearer', apiKey: 'sk-upstream'
};
const EMBED_NO_USAGE_CONFIG = {
  model: 'embed-no-usage', providerType: 'OPENAI',
  baseUrl: 'http://127.0.0.1:4007', path: '/v1/embeddings',
  pricing: { inputPrice: 0.02, outputPrice: 0.1, cachePrice: 0 },
  providerId: 1, authType: 'bearer', apiKey: 'sk-upstream'
};
const EMBED_ZERO_USAGE_CONFIG = {
  model: 'embed-zero-usage', providerType: 'OPENAI',
  baseUrl: 'http://127.0.0.1:4007', path: '/v1/embeddings',
  pricing: { inputPrice: 0.02, outputPrice: 0.1, cachePrice: 0 },
  providerId: 1, authType: 'bearer', apiKey: 'sk-upstream'
};
const EMBED_ERROR_CONFIG = {
  model: 'embed-error', providerType: 'OPENAI',
  baseUrl: 'http://127.0.0.1:4007', path: '/v1/embeddings-error',
  pricing: { inputPrice: 0.02, outputPrice: 0.1, cachePrice: 0 },
  providerId: 1, authType: 'bearer', apiKey: 'sk-upstream'
};

before(async () => {
  process.env.INTERNAL_SECRET = 'test-secret';
  process.env.ADMIN_API_URL = 'http://127.0.0.1:4008';
  process.env.RESOLVE_CACHE_TTL = '0.5';

  admin = Fastify();
  admin.post('/internal/keys/verify', async (req, reply) => {
    const { apiKey } = req.body as any;
    if (!apiKey) return reply.status(401).send({ error: 'Invalid API key' });
    return { keyId: 1, userId: 1, rateLimit: 60, dailyQuota: 100000, monthlyQuota: 3000000, userBalance: 100, todayTokens: 0, monthTokens: 0 };
  });
  admin.post('/internal/models/resolve', async (req, reply) => {
    const { model } = req.body as any;
    if (model === 'embed-usage') return EMBED_USAGE_CONFIG;
    if (model === 'embed-no-usage') return EMBED_NO_USAGE_CONFIG;
    if (model === 'embed-zero-usage') return EMBED_ZERO_USAGE_CONFIG;
    if (model === 'embed-error') return EMBED_ERROR_CONFIG;
    return reply.status(404).send({ error: 'Model not found' });
  });
  admin.post('/internal/usage/report', async (req, reply) => { reported.push(req.body); return { success: true }; });
  await admin.listen({ port: 4008, host: '127.0.0.1' });

  upstream = Fastify();
  upstream.post('/v1/embeddings', async (req, reply) => {
    const { input } = req.body as any;
    const inputs = Array.isArray(input) ? input : [input];
    if (req.body.model === 'embed-usage') {
      return {
        object: 'list',
        data: inputs.map((_: string, i: number) => ({ object: 'embedding', index: i, embedding: [0.1, 0.2, 0.3] })),
        model: 'embed-usage',
        usage: { prompt_tokens: 123, total_tokens: 123 }
      };
    }
    if (req.body.model === 'embed-zero-usage') {
      return {
        object: 'list',
        data: inputs.map((_: string, i: number) => ({ object: 'embedding', index: i, embedding: [0.1, 0.2, 0.3] })),
        model: 'embed-zero-usage',
        usage: { prompt_tokens: 0, total_tokens: 0 }
      };
    }
    return {
      object: 'list',
      data: inputs.map((_: string, i: number) => ({ object: 'embedding', index: i, embedding: [0.1, 0.2, 0.3] })),
      model: 'embed-no-usage'
    };
  });
  upstream.post('/v1/embeddings-error', async (_req, reply) => {
    return reply.status(429).send({ error: { message: 'Rate limit reached', type: 'rate_limit_error', code: 'rate_limit_exceeded' } });
  });
  await upstream.listen({ port: 4007, host: '127.0.0.1' });

  gateway = await buildApp();
});

after(async () => {
  await gateway.close();
  await admin.close();
  await upstream.close();
});

test('POST /v1/embeddings: bills by usage.prompt_tokens', async () => {
  const beforeCount = reported.length;
  const res = await gateway.inject({
    method: 'POST', url: '/v1/embeddings',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'embed-usage', input: 'hello world' }
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.object, 'list');
  assert.equal(body.data.length, 1);
  await new Promise(r => setTimeout(r, 50));
  const usage = reported.slice(beforeCount).find(r => r.model === 'embed-usage');
  assert.ok(usage, 'usage should be reported');
  assert.equal(usage.tokensIn, 123);
  assert.equal(usage.tokensOut, 0);
  assert.equal(usage.cachedTokens, 0);
  assert.ok(usage.cost > 0);
  assert.equal(usage.providerId, 1);
});

test('POST /v1/embeddings: usage.prompt_tokens=0 is honored, not estimated', async () => {
  const beforeCount = reported.length;
  const input = 'hello world';
  const res = await gateway.inject({
    method: 'POST', url: '/v1/embeddings',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'embed-zero-usage', input }
  });
  assert.equal(res.statusCode, 200);
  await new Promise(r => setTimeout(r, 50));
  const usage = reported.slice(beforeCount).find(r => r.model === 'embed-zero-usage');
  assert.ok(usage, 'usage should be reported');
  assert.equal(usage.tokensIn, 0);
  assert.equal(usage.cost, 0);
});

test('POST /v1/embeddings: no upstream usage -> estimate tokensIn by char length / 4', async () => {
  const beforeCount = reported.length;
  const input = 'hello world';
  const res = await gateway.inject({
    method: 'POST', url: '/v1/embeddings',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'embed-no-usage', input }
  });
  assert.equal(res.statusCode, 200);
  await new Promise(r => setTimeout(r, 50));
  const usage = reported.slice(beforeCount).find(r => r.model === 'embed-no-usage');
  assert.ok(usage, 'usage should be reported');
  assert.equal(usage.tokensIn, estimateTokensIn(input));
  assert.equal(usage.tokensOut, 0);
  assert.equal(usage.cachedTokens, 0);
});

test('POST /v1/embeddings: array input sums up estimate across elements', async () => {
  const beforeCount = reported.length;
  const input = ['this is a longer text', 'short'];
  const res = await gateway.inject({
    method: 'POST', url: '/v1/embeddings',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'embed-no-usage', input }
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.data.length, 2);
  await new Promise(r => setTimeout(r, 50));
  const usage = reported.slice(beforeCount).find(r => r.model === 'embed-no-usage');
  assert.ok(usage, 'usage should be reported');
  assert.equal(usage.tokensIn, estimateTokensIn(input));
  assert.ok(usage.tokensIn > estimateTokensIn('short'), 'multi-element estimate should grow');
});

test('POST /v1/embeddings: non-2xx upstream is forwarded with real status, no usage reported', async () => {
  const beforeCount = reported.length;
  const res = await gateway.inject({
    method: 'POST', url: '/v1/embeddings',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'embed-error', input: 'hello' }
  });
  assert.equal(res.statusCode, 429);
  const body = res.json();
  assert.equal(body.error.message, 'Rate limit reached');
  assert.equal(body.error.type, 'rate_limit_error');
  await new Promise(r => setTimeout(r, 50));
  const usage = reported.slice(beforeCount).find(r => r.model === 'embed-error');
  assert.ok(!usage, 'no usage should be reported on upstream error');
});

test('POST /v1/embeddings: missing model and input returns 400', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/embeddings',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'embed-usage' }
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'invalid_body');
});

test('POST /v1/embeddings: empty input array returns 400', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/embeddings',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'embed-usage', input: [] }
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'invalid_body');
});

test('POST /v1/embeddings: unauthenticated request returns 401', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/embeddings',
    payload: { model: 'embed-usage', input: 'hello' }
  });
  assert.equal(res.statusCode, 401);
});
