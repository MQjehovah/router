import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { buildApp } from '../src/app.js';

const reported: any[] = [];
let admin: Fastify.FastifyInstance;
let gateway: Fastify.FastifyInstance;
let upstream: Fastify.FastifyInstance;

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

before(async () => {
  process.env.INTERNAL_SECRET = 'test-secret';
  process.env.ADMIN_API_URL = 'http://127.0.0.1:3998';

  admin = Fastify();
  admin.post('/internal/keys/verify', async (_req, reply) => reply.send({ keyId: 1, userId: 1, rateLimit: 60, dailyQuota: 100000, monthlyQuota: 3000000, userBalance: 100 }));
  admin.post('/internal/models/resolve', async (req, reply) => {
    const { model } = req.body as any;
    if (model === 'deepseek-chat') return RESPONSES_CONFIG;
    if (model === 'chat-only') return CHAT_ONLY_CONFIG;
    if (model === 'claude-model') return MESSAGES_CONFIG;
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
  assert.equal(usage.tokensIn, 100);
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
  assert.equal(usage.tokensIn, 100);
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
