import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allow } from '../src/ratelimit.js';

// now 显式注入, 不依赖真实时钟: 覆盖计数、滑动过期与半开区间边界。
// 每个用例使用互不相同的 key, 复用模块级 Map 也不相互干扰。
// allow 返回值: 0 = 放行; >0 = 拒绝, 且为窗口内最早命中滑出所需毫秒(Retry-After 依据)。
test('allow: 窗口内放行到限额, 第 limit+1 次拒绝并返回剩余毫秒', () => {
  const key = 'window/basic';
  assert.equal(allow(key, 3, 1000, 100), 0);
  assert.equal(allow(key, 3, 1000, 200), 0);
  assert.equal(allow(key, 3, 1000, 300), 0);
  // 最早命中 t=100 在 now=1100 滑出(半开区间), t=400 时剩余 700ms
  assert.equal(allow(key, 3, 1000, 400), 700);
  // 被拒请求不记账: 同一时刻重复拒绝, 剩余时间不变
  assert.equal(allow(key, 3, 1000, 400), 700);
  assert.equal(allow(key, 3, 1000, 900), 200);
  assert.equal(allow(key, 3, 1000, 1099), 1, '剩余时间精确到毫秒');
  assert.equal(allow(key, 3, 1000, 1100), 0, '最早命中恰好滑出, 重新放行');
});

test('allow: 旧命中滑出窗口后重新放行(半开区间)', () => {
  const key = 'window/slide';
  assert.equal(allow(key, 2, 1000, 0), 0);
  assert.equal(allow(key, 2, 1000, 500), 0);
  assert.equal(allow(key, 2, 1000, 999), 1, 't=0 的命中仍在窗口内(t > now-windowMs)');
  assert.equal(allow(key, 2, 1000, 1000), 0, 't=1000 时 t=0 的命中恰好出窗');
  assert.equal(allow(key, 2, 1000, 1100), 400, '此时窗口内是 t=500 与 t=1000, 最早 t=500 在 1500 滑出');
});

test('allow: 跨窗口按时间戳逐个滑出, 而非整窗重置', () => {
  const key = 'window/roll';
  assert.equal(allow(key, 2, 1000, 0), 0);
  assert.equal(allow(key, 2, 1000, 600), 0);
  assert.equal(allow(key, 2, 1000, 1000), 0, '仅 t=0 出窗');
  assert.equal(allow(key, 2, 1000, 1100), 500, 't=600 在 1600 滑出');
});

test('allow: limit=1 时窗口内第二次即拒绝, 剩余时间随窗口推进递减', () => {
  const key = 'window/one';
  assert.equal(allow(key, 1, 500, 10), 0);
  assert.equal(allow(key, 1, 500, 500), 10, 't=10 在 510 滑出');
  assert.equal(allow(key, 1, 500, 509), 1);
  assert.equal(allow(key, 1, 500, 510), 0);
});

test('allow: 不同 key 独立计数', () => {
  assert.equal(allow('window/a', 1, 1000, 0), 0);
  assert.equal(allow('window/b', 1, 1000, 0), 0, '其它 key 不受影响');
  assert.ok(allow('window/a', 1, 1000, 1) > 0);
  assert.ok(allow('window/b', 1, 1000, 1) > 0);
});
