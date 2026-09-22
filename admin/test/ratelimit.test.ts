import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allow } from '../src/ratelimit.js';

// now 显式注入, 不依赖真实时钟: 覆盖计数、滑动过期与半开区间边界。
// 每个用例使用互不相同的 key, 复用模块级 Map 也不相互干扰。
test('allow: 窗口内放行到限额, 第 limit+1 次拒绝', () => {
  const key = 'window/basic';
  assert.equal(allow(key, 3, 1000, 100), true);
  assert.equal(allow(key, 3, 1000, 200), true);
  assert.equal(allow(key, 3, 1000, 300), true);
  assert.equal(allow(key, 3, 1000, 400), false);
  // 被拒请求不记账: 同窗口内重复调用持续拒绝
  assert.equal(allow(key, 3, 1000, 500), false);
});

test('allow: 旧命中滑出窗口后重新放行(半开区间)', () => {
  const key = 'window/slide';
  assert.equal(allow(key, 2, 1000, 0), true);
  assert.equal(allow(key, 2, 1000, 500), true);
  assert.equal(allow(key, 2, 1000, 999), false, 't=0 的命中仍在窗口内(t > now-windowMs)');
  assert.equal(allow(key, 2, 1000, 1000), true, 't=1000 时 t=0 的命中恰好出窗');
  assert.equal(allow(key, 2, 1000, 1100), false, '此时窗口内是 t=500 与 t=1000 两次');
});

test('allow: 跨窗口按时间戳逐个滑出, 而非整窗重置', () => {
  const key = 'window/roll';
  assert.equal(allow(key, 2, 1000, 0), true);
  assert.equal(allow(key, 2, 1000, 600), true);
  assert.equal(allow(key, 2, 1000, 1000), true, '仅 t=0 出窗');
  assert.equal(allow(key, 2, 1000, 1100), false, 't=600 与 t=1000 都在窗内');
});

test('allow: limit=1 时窗口内第二次即拒绝', () => {
  const key = 'window/one';
  assert.equal(allow(key, 1, 500, 10), true);
  assert.equal(allow(key, 1, 500, 509), false);
  assert.equal(allow(key, 1, 500, 510), true, 't=10 的命中出窗');
});

test('allow: 不同 key 独立计数', () => {
  assert.equal(allow('window/a', 1, 1000, 0), true);
  assert.equal(allow('window/b', 1, 1000, 0), true, '其它 key 不受影响');
  assert.equal(allow('window/a', 1, 1000, 1), false);
  assert.equal(allow('window/b', 1, 1000, 1), false);
});
