import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimedCache } from '../src/key-cache.js';

test('createTimedCache: returns undefined for missing key', () => {
  const c = createTimedCache<number>(1000);
  assert.equal(c.get('a'), undefined);
});

test('createTimedCache: get returns set value within TTL', () => {
  const c = createTimedCache<number>(1000);
  c.set('a', 42);
  assert.equal(c.get('a'), 42);
});

test('createTimedCache: entry expires after TTL', () => {
  let now = 0;
  const c = createTimedCache<number>(1000, () => now);
  c.set('a', 42);
  now = 999;
  assert.equal(c.get('a'), 42);
  now = 1000;
  assert.equal(c.get('a'), undefined);
});

test('createTimedCache: clear removes all entries', () => {
  const c = createTimedCache<number>(1000);
  c.set('a', 1);
  c.set('b', 2);
  c.clear();
  assert.equal(c.get('a'), undefined);
  assert.equal(c.get('b'), undefined);
});
