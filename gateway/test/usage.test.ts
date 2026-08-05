import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUsage, calculateCost, createUsageStream } from '../src/providers/usage.js';

test('extractUsage: OpenAI cached via prompt_tokens_details', () => {
  const u = extractUsage('OPENAI', { usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 30 } } });
  assert.deepEqual(u, { tokensIn: 100, tokensOut: 50, cachedTokens: 30 });
});

test('extractUsage: DeepSeek cached via prompt_cache_hit_tokens', () => {
  const u = extractUsage('DEEPSEEK', { usage: { prompt_tokens: 100, completion_tokens: 50, prompt_cache_hit_tokens: 40 } });
  assert.deepEqual(u, { tokensIn: 100, tokensOut: 50, cachedTokens: 40 });
});

test('extractUsage: Anthropic', () => {
  const u = extractUsage('ANTHROPIC', { usage: { input_tokens: 120, output_tokens: 60, cache_read_input_tokens: 80 } });
  assert.deepEqual(u, { tokensIn: 120, tokensOut: 60, cachedTokens: 80 });
});

test('extractUsage: Google', () => {
  const u = extractUsage('GOOGLE', { usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 90, cachedContentTokenCount: 150 } });
  assert.deepEqual(u, { tokensIn: 200, tokensOut: 90, cachedTokens: 150 });
});

test('extractUsage: empty body -> zeros', () => {
  assert.deepEqual(extractUsage('OPENAI', {}), { tokensIn: 0, tokensOut: 0, cachedTokens: 0 });
});

test('calculateCost: cache price applies to cached input only', () => {
  const cost = calculateCost({ tokensIn: 1000, tokensOut: 500, cachedTokens: 400 }, { inputPrice: 2, outputPrice: 8, cachePrice: 0.5 });
  assert.equal(cost, (600 * 2 + 400 * 0.5 + 500 * 8) / 1_000_000);
});

test('createUsageStream: preserves bytes and extracts usage across chunk boundaries', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"a"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"prompt_cache_hit_tokens":7}}\n\n',
    'data: [DONE]\n\n'
  ];
  const input = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      const first = enc.encode(sse[0]);
      c.enqueue(first.slice(0, 20));
      c.enqueue(first.slice(20));
      c.enqueue(enc.encode(sse[1]));
      c.close();
    }
  });

  let reported: any = null;
  const out = input.pipeThrough(createUsageStream('DEEPSEEK', async (u) => { reported = u; }));

  const chunks: Uint8Array[] = [];
  const reader = out.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  const text = new TextDecoder().decode(bytes);
  assert.equal(text, sse[0] + sse[1]);
  assert.deepEqual(reported, { tokensIn: 10, tokensOut: 5, cachedTokens: 7 });
});

async function collectStream(providerType: string, events: string[]) {
  let reported: any = null;
  const input = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const e of events) c.enqueue(enc.encode(e));
      c.close();
    }
  });
  const out = input.pipeThrough(createUsageStream(providerType, async (u) => { reported = u; }));
  const reader = out.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
  return reported;
}

test('createUsageStream: Anthropic message_start + message_delta', async () => {
  const reported = await collectStream('ANTHROPIC', [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":120,"output_tokens":0,"cache_read_input_tokens":80}}}\n\n',
    'data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n',
    'data: {"type":"message_delta","usage":{"output_tokens":60}}\n\n',
    'data: [DONE]\n\n'
  ]);
  assert.deepEqual(reported, { tokensIn: 120, tokensOut: 60, cachedTokens: 80 });
});

test('createUsageStream: Google usageMetadata in final chunk only', async () => {
  const reported = await collectStream('GOOGLE', [
    'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n',
    'data: {"usageMetadata":{"promptTokenCount":200,"candidatesTokenCount":90,"cachedContentTokenCount":150}}\n\n'
  ]);
  assert.deepEqual(reported, { tokensIn: 200, tokensOut: 90, cachedTokens: 150 });
});

test('createUsageStream: OpenAI final chunk with usage; [DONE] and comment lines skipped; no trailing newline', async () => {
  const reported = await collectStream('OPENAI', [
    'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
    ': ping comment\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":30,"completion_tokens":12,"prompt_tokens_details":{"cached_tokens":9}}}',
  ]);
  assert.deepEqual(reported, { tokensIn: 30, tokensOut: 12, cachedTokens: 9 });
});
