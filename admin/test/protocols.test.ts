import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveProtocolPath } from '../src/protocols.js';

test('effectiveProtocolPath: null path uses protocol default', () => {
  assert.equal(effectiveProtocolPath('OPENAI_CHAT', null), '/chat/completions');
  assert.equal(effectiveProtocolPath('OPENAI_RESPONSES', undefined), '/responses');
  assert.equal(effectiveProtocolPath('ANTHROPIC_MESSAGES', null), '/v1/messages');
});

test('effectiveProtocolPath: custom path overrides default', () => {
  assert.equal(effectiveProtocolPath('OPENAI_RESPONSES', '/v1/custom/responses'), '/v1/custom/responses');
});

test('effectiveProtocolPath: empty string path treated as unset', () => {
  assert.equal(effectiveProtocolPath('OPENAI_CHAT', ''), '/chat/completions');
});
