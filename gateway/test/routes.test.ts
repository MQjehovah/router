import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { buildApp } from '../src/app.js';

const reported: any[] = [];
let admin: Fastify.FastifyInstance;
let gateway: Fastify.FastifyInstance;
let upstream: Fastify.FastifyInstance;
let resolveCalls = 0;

const RESPONSES_CONFIG = {
  model: 'deepseek-chat', providerType: 'DEEPSEEK',
  baseUrl: 'http://127.0.0.1:3997', path: '/chat/completions',
  protocols: [
    { protocol: 'OPENAI_CHAT', path: '/chat/completions' },
    { protocol: 'OPENAI_RESPONSES', path: '/responses' }
  ],
  pricing: { inputPrice: 0.1, outputPrice: 0.3, cachePrice: 0.05 },
  providerId: 1, authType: 'bearer', apiKey: 'sk-upstream'
};
const CHAT_ONLY_CONFIG = { ...RESPONSES_CONFIG, model: 'chat-only', protocols: [{ protocol: 'OPENAI_CHAT', path: '/chat/completions' }] };
const ERROR_RESPONSES_CONFIG = { ...RESPONSES_CONFIG, model: 'deepseek-error', protocols: [{ protocol: 'OPENAI_RESPONSES', path: '/responses-error' }] };
const ERROR_TEXT_CONFIG = { ...RESPONSES_CONFIG, model: 'deepseek-error-text', protocols: [{ protocol: 'OPENAI_RESPONSES', path: '/responses-error-text' }] };
const MESSAGES_CONFIG = {
  model: 'claude-model', providerType: 'ANTHROPIC',
  baseUrl: 'http://127.0.0.1:3997', path: '/chat/completions',
  protocols: [
    { protocol: 'OPENAI_CHAT', path: '/chat/completions' },
    { protocol: 'ANTHROPIC_MESSAGES', path: '/v1/messages' }
  ],
  pricing: { inputPrice: 3, outputPrice: 15, cachePrice: 0.3 },
  providerId: 2, authType: 'anthropic', apiKey: 'sk-anthropic'
};
const ERROR_MESSAGES_CONFIG = { ...MESSAGES_CONFIG, model: 'claude-error', protocols: [{ protocol: 'ANTHROPIC_MESSAGES', path: '/v1/messages-error' }] };

before(async () => {
  process.env.INTERNAL_SECRET = 'test-secret';
  process.env.ADMIN_API_URL = 'http://127.0.0.1:3998';
  process.env.RESOLVE_CACHE_TTL = '0.5';

  admin = Fastify();
  admin.post('/internal/keys/verify', async (req, reply) => {
    const { apiKey } = req.body as any;
    if (apiKey === 'quota-daily-key') return { keyId: 2, userId: 1, rateLimit: 60, dailyQuota: 100, monthlyQuota: 100000, userBalance: 100, todayTokens: 150, monthTokens: 200 };
    if (apiKey === 'quota-monthly-key') return { keyId: 3, userId: 1, rateLimit: 60, dailyQuota: 100000, monthlyQuota: 100, userBalance: 100, todayTokens: 50, monthTokens: 500 };
    if (apiKey === 'balance-key') return { keyId: 4, userId: 1, rateLimit: 60, dailyQuota: 100000, monthlyQuota: 3000000, userBalance: 0, todayTokens: 0, monthTokens: 0 };
    if (apiKey === 'quota-model-daily-key') return { keyId: 5, userId: 1, rateLimit: 60, dailyQuota: 100000, monthlyQuota: 100000, userBalance: 100, todayTokens: 0, monthTokens: 0, modelDailyQuota: 100, modelMonthlyQuota: 100000, modelTodayTokens: 150, modelMonthTokens: 150 };
    if (apiKey === 'quota-model-monthly-key') return { keyId: 6, userId: 1, rateLimit: 60, dailyQuota: 100000, monthlyQuota: 100000, userBalance: 100, todayTokens: 0, monthTokens: 0, modelDailyQuota: 100000, modelMonthlyQuota: 100, modelTodayTokens: 50, modelMonthTokens: 500 };
    if (apiKey === 'quota-model-ok-key') return { keyId: 7, userId: 1, rateLimit: 60, dailyQuota: 100000, monthlyQuota: 100000, userBalance: 100, todayTokens: 0, monthTokens: 0, modelDailyQuota: 100, modelMonthlyQuota: 100, modelTodayTokens: 50, modelMonthTokens: 50 };
    return { keyId: 1, userId: 1, rateLimit: 60, dailyQuota: 100000, monthlyQuota: 3000000, userBalance: 100, todayTokens: 0, monthTokens: 0 };
  });
  admin.post('/internal/keys/models', async (req, reply) => {
    const { apiKey } = req.body as any;
    if (apiKey === 'granted-key') return { models: ['deepseek-chat'] };
    return { models: ['deepseek-chat', 'chat-only'] };
  });
  admin.post('/internal/models/resolve', async (req, reply) => {
    resolveCalls++;
    const { model } = req.body as any;
    if (model === 'deepseek-chat') return RESPONSES_CONFIG;
    if (model === 'deepseek-ttl') return RESPONSES_CONFIG;
    if (model === 'deepseek-cache-hit') return RESPONSES_CONFIG;
    if (model === 'chat-only') return CHAT_ONLY_CONFIG;
    if (model === 'deepseek-error') return ERROR_RESPONSES_CONFIG;
    if (model === 'deepseek-error-text') return ERROR_TEXT_CONFIG;
    if (model === 'claude-model') return MESSAGES_CONFIG;
    if (model === 'claude-error') return ERROR_MESSAGES_CONFIG;
    return reply.status(404).send({ error: 'Model not found' });
  });
  admin.post('/internal/usage/report', async (req, reply) => { reported.push(req.body); return { success: true }; });
  await admin.listen({ port: 3998, host: '127.0.0.1' });

  upstream = Fastify();
  upstream.post('/responses', async (req, reply) => {
    const { stream } = req.body as any;
    if (stream) {
      reply.header('Content-Type', 'text/event-stream');
      return reply.send('data: {"type":"response.output_text.delta","delta":"hi"}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":50,"input_tokens_details":{"cached_tokens":30}}}}\n\ndata: [DONE]\n\n');
    }
    return {
      id: 'resp_test', object: 'response', status: 'completed', model: 'deepseek-chat', created_at: 1,
      output: [{ type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'hi', annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150, input_tokens_details: { cached_tokens: 30 } }
    };
  });
  upstream.post('/responses-error', async (_req, reply) => {
    return reply.status(429).send({ error: { message: 'Insufficient Balance', type: 'insufficient_quota', code: 'insufficient_quota' } });
  });
  upstream.post('/responses-error-text', async (_req, reply) => {
    return reply.status(502).send('upstream exploded');
  });
  upstream.post('/v1/messages-error', async (_req, reply) => {
    return reply.status(429).send({ type: 'error', error: { type: 'rate_limit_error', message: 'Request was throttled' } });
  });
  upstream.post('/v1/messages', async (req, reply) => {
    const { stream } = req.body as any;
    if (stream) {
      reply.header('Content-Type', 'text/event-stream');
      return reply.send('data: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":0,"cache_read_input_tokens":5}}}\n\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":10}}\n\ndata: [DONE]\n\n');
    }
    return { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'hi' }], model: 'claude-model', stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 5 } };
  });
  await upstream.listen({ port: 3997, host: '127.0.0.1' });

  gateway = await buildApp();
});

after(async () => {
  await gateway.close();
  await admin.close();
  await upstream.close();
});

test('POST /v1/responses: passthrough and reports usage', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'deepseek-chat', input: [{ role: 'user', content: 'hi' }] }
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.object, 'response');
  assert.equal(body.output[0].content[0].text, 'hi');
  await new Promise(r => setTimeout(r, 50));
  const usage = reported.find(r => r.model === 'deepseek-chat');
  assert.ok(usage, 'usage should be reported');
  assert.equal(usage.tokensIn, 70);
  assert.equal(usage.tokensOut, 50);
  assert.equal(usage.cachedTokens, 30);
});

test('POST /v1/responses: protocol not supported', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'chat-only', input: [] }
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'protocol_not_supported');
});

test('POST /v1/messages: passthrough via x-api-key and reports usage', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/messages',
    headers: { 'x-api-key': 'test-key' },
    payload: { model: 'claude-model', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.type, 'message');
  assert.equal(body.content[0].text, 'hi');
  await new Promise(r => setTimeout(r, 50));
  const usage = reported.find(r => r.model === 'claude-model');
  assert.ok(usage);
  assert.equal(usage.tokensIn, 20);
  assert.equal(usage.tokensOut, 10);
  assert.equal(usage.cachedTokens, 5);
});

test('POST /v1/responses: streaming passthrough preserves bytes and reports usage', async () => {
  const sse = 'data: {"type":"response.output_text.delta","delta":"hi"}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":50,"input_tokens_details":{"cached_tokens":30}}}}\n\ndata: [DONE]\n\n';
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'deepseek-chat', stream: true, input: [] }
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['content-type'].startsWith('text/event-stream'));
  assert.equal(res.body, sse);
  await new Promise(r => setTimeout(r, 50));
  const usage = reported.filter(r => r.model === 'deepseek-chat').at(-1);
  assert.ok(usage, 'usage should be reported for streaming');
  assert.equal(usage.tokensIn, 70);
  assert.equal(usage.tokensOut, 50);
  assert.equal(usage.cachedTokens, 30);
});

test('POST /v1/messages: streaming passthrough preserves bytes and reports usage', async () => {
  const sse = 'data: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":0,"cache_read_input_tokens":5}}}\n\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":10}}\n\ndata: [DONE]\n\n';
  const res = await gateway.inject({
    method: 'POST', url: '/v1/messages',
    headers: { 'x-api-key': 'test-key' },
    payload: { model: 'claude-model', stream: true, max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['content-type'].startsWith('text/event-stream'));
  assert.equal(res.body, sse);
  await new Promise(r => setTimeout(r, 50));
  const usage = reported.filter(r => r.model === 'claude-model').at(-1);
  assert.ok(usage, 'usage should be reported for streaming');
  assert.equal(usage.tokensIn, 20);
  assert.equal(usage.tokensOut, 10);
  assert.equal(usage.cachedTokens, 5);
});

test('POST /v1/messages: protocol not supported', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/messages',
    headers: { 'x-api-key': 'test-key' },
    payload: { model: 'chat-only', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.type, 'error');
  assert.ok(body.error.message.includes('anthropic messages protocol'));
});

test('POST /v1/responses: daily quota exceeded returns 429', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer quota-daily-key' },
    payload: { model: 'deepseek-chat', input: [] }
  });
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error.code, 'daily_quota_exceeded');
});

test('POST /v1/responses: monthly quota exceeded returns 429', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer quota-monthly-key' },
    payload: { model: 'deepseek-chat', input: [] }
  });
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error.code, 'monthly_quota_exceeded');
});

test('POST /v1/responses: insufficient balance returns 402', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer balance-key' },
    payload: { model: 'deepseek-chat', input: [] }
  });
  assert.equal(res.statusCode, 402);
  assert.equal(res.json().error.code, 'insufficient_balance');
});

test('POST /v1/responses: daily model quota exceeded returns 429', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer quota-model-daily-key' },
    payload: { model: 'deepseek-chat', input: [] }
  });
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error.code, 'daily_model_quota_exceeded');
});

test('POST /v1/responses: monthly model quota exceeded returns 429', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer quota-model-monthly-key' },
    payload: { model: 'deepseek-chat', input: [] }
  });
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error.code, 'monthly_model_quota_exceeded');
});

test('POST /v1/responses: model quota not exceeded passes through', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer quota-model-ok-key' },
    payload: { model: 'deepseek-chat', input: [] }
  });
  assert.equal(res.statusCode, 200);
});

test('GET /v1/models: returns only granted models for a key with grants', async () => {
  const res = await gateway.inject({
    method: 'GET', url: '/v1/models',
    headers: { authorization: 'Bearer granted-key' }
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  const ids = body.data.map((m: any) => m.id);
  assert.deepEqual(ids, ['deepseek-chat']);
});

test('GET /v1/models: returns all active models for a key without grants', async () => {
  const res = await gateway.inject({
    method: 'GET', url: '/v1/models',
    headers: { authorization: 'Bearer test-key' }
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  const ids = body.data.map((m: any) => m.id);
  assert.deepEqual(ids, ['deepseek-chat', 'chat-only']);
});

test('POST /v1/responses: model not found maps to openai error', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'nope', input: [] }
  });
  assert.equal(res.statusCode, 404);
  const body = res.json();
  assert.ok(body.error.message, 'error message should be set');
  assert.equal(body.error.type, 'invalid_request_error');
});

test('POST /v1/responses: resolve result is cached across repeated requests', async () => {
  const base = resolveCalls;
  for (let i = 0; i < 3; i++) {
    const res = await gateway.inject({
      method: 'POST', url: '/v1/responses',
      headers: { authorization: 'Bearer test-key' },
      payload: { model: 'deepseek-cache-hit', input: [] }
    });
    assert.equal(res.statusCode, 200);
  }
  assert.equal(resolveCalls, base + 1, 'resolve should be called only once for repeated identical requests');
});

test('POST /v1/responses: resolve cache expires after TTL', async () => {
  const base = resolveCalls;
  const req = () => gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'deepseek-ttl', input: [] }
  });
  const r1 = await req();
  assert.equal(r1.statusCode, 200);
  await new Promise(r => setTimeout(r, 700));
  const r2 = await req();
  assert.equal(r2.statusCode, 200);
  assert.equal(resolveCalls, base + 2, 'resolve should be called again after TTL expiry');
});

test('POST /v1/responses: upstream json error is forwarded with real status', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'deepseek-error', input: [] }
  });
  assert.equal(res.statusCode, 429);
  const body = res.json();
  assert.equal(body.error.message, 'Insufficient Balance');
  assert.equal(body.error.type, 'insufficient_quota');
  assert.equal(body.error.code, 'insufficient_quota');
});

test('POST /v1/responses: upstream non-json error is wrapped but keeps real message', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'deepseek-error-text', input: [] }
  });
  assert.equal(res.statusCode, 502);
  const body = res.json();
  assert.equal(body.error.message, 'upstream exploded');
  assert.equal(body.error.type, 'provider_error');
});

test('POST /v1/messages: upstream anthropic error is forwarded with real status', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/messages',
    headers: { 'x-api-key': 'test-key' },
    payload: { model: 'claude-error', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }
  });
  assert.equal(res.statusCode, 429);
  const body = res.json();
  assert.equal(body.type, 'error');
  assert.equal(body.error.type, 'rate_limit_error');
  assert.equal(body.error.message, 'Request was throttled');
});

test('interrupted stream reports partial usage at zero cost', async () => {
  const { createReportedUsageStream } = await import('../src/routes/helpers.js');
  let closeCb: (() => void) | undefined;
  const fakeReply = { raw: { on: (event: string, cb: () => void) => { if (event === 'close') closeCb = cb; } } } as any;
  const fastifyMock = { log: { warn: () => {}, error: () => {} } } as any;
  const encoder = new TextEncoder();

  const stream = createReportedUsageStream(fastifyMock, {
    apiKey: 'test-key', providerId: 2, model: 'claude-partial',
    pricing: { inputPrice: 3, outputPrice: 15, cachePrice: 0.3 },
    format: 'anthropic', reply: fakeReply, latencyMs: 10
  });
  const reader = stream.readable.getReader();
  const drain = (async () => { for (;;) { const { done } = await reader.read(); if (done) break; } })().catch(() => {});
  const writer = stream.writable.getWriter();
  await writer.write(encoder.encode('data: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":0,"cache_read_input_tokens":5}}}\n\ndata: {"type":"content_block_delta","delta":{"text":"par"}}\n\n'));

  closeCb?.();
  await new Promise(r => setTimeout(r, 50));
  const usage = reported.filter(r => r.model === 'claude-partial').at(-1);
  assert.ok(usage, 'partial usage should be reported on close');
  assert.equal(usage.tokensIn, 20);
  assert.equal(usage.tokensOut, 0);
  assert.equal(usage.cachedTokens, 5);
  assert.equal(usage.cost, 0);

  await writer.close().catch(() => {});
  await drain;
});

test('interrupted stream with no accumulated tokens reports nothing', async () => {
  const { createReportedUsageStream } = await import('../src/routes/helpers.js');
  let closeCb: (() => void) | undefined;
  const fakeReply = { raw: { on: (event: string, cb: () => void) => { if (event === 'close') closeCb = cb; } } } as any;
  const fastifyMock = { log: { warn: () => {}, error: () => {} } } as any;
  const encoder = new TextEncoder();

  const before = reported.length;
  const stream = createReportedUsageStream(fastifyMock, {
    apiKey: 'test-key', providerId: 2, model: 'claude-empty-partial',
    pricing: { inputPrice: 3, outputPrice: 15, cachePrice: 0.3 },
    format: 'anthropic', reply: fakeReply, latencyMs: 10
  });
  const reader = stream.readable.getReader();
  const drain = (async () => { for (;;) { const { done } = await reader.read(); if (done) break; } })().catch(() => {});
  const writer = stream.writable.getWriter();
  await writer.write(encoder.encode('data: {"type":"content_block_delta","delta":{"text":"x"}}\n\n'));

  closeCb?.();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(reported.length, before, 'no record when no tokens accumulated');

  await writer.close().catch(() => {});
  await drain;
});

test('reported usage stream reports full usage with cost on normal completion', async () => {
  const { createReportedUsageStream } = await import('../src/routes/helpers.js');
  const fakeReply = { raw: { on: () => {} } } as any;
  const fastifyMock = { log: { warn: () => {}, error: () => {} } } as any;
  const encoder = new TextEncoder();

  const stream = createReportedUsageStream(fastifyMock, {
    apiKey: 'test-key', providerId: 2, model: 'claude-normal',
    pricing: { inputPrice: 3, outputPrice: 15, cachePrice: 0.3 },
    format: 'anthropic', reply: fakeReply, latencyMs: 10
  });
  const reader = stream.readable.getReader();
  const drain = (async () => { for (;;) { const { done } = await reader.read(); if (done) break; } })().catch(() => {});
  const writer = stream.writable.getWriter();
  await writer.write(encoder.encode('data: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":0,"cache_read_input_tokens":5}}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":10}}\n\n'));
  await writer.close();
  await drain;
  await new Promise(r => setTimeout(r, 50));
  const usage = reported.filter(r => r.model === 'claude-normal').at(-1);
  assert.ok(usage, 'usage should be reported on flush');
  assert.equal(usage.tokensIn, 20);
  assert.equal(usage.tokensOut, 10);
  assert.equal(usage.cachedTokens, 5);
  assert.ok(usage.cost > 0, 'completed stream should be billed');
});
