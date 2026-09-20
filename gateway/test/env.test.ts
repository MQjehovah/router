import { test } from 'node:test'
import assert from 'node:assert/strict'

import { WEAK_VALUES, isProduction, requireSecret, corsOrigins } from '../src/env.js'

test('isProduction 识别 production/prod(大小写不敏感)', () => {
  for (const v of ['production', 'PROD', 'Prod']) {
    process.env.APP_ENV = v
    assert.equal(isProduction(), true)
  }
  process.env.APP_ENV = 'development'
  assert.equal(isProduction(), false)
  delete process.env.APP_ENV
  assert.equal(isProduction(), false)
})

test('requireSecret 生产拒绝缺失/空值并指出变量名', () => {
  process.env.APP_ENV = 'production'
  try {
    assert.throws(() => requireSecret('JWT_SECRET', undefined), /JWT_SECRET/)
    assert.throws(() => requireSecret('INTERNAL_SECRET', ''), /INTERNAL_SECRET/)
    assert.throws(() => requireSecret('OTHER', '   '), /OTHER/)
  } finally {
    delete process.env.APP_ENV
  }
})

test('requireSecret 生产拒绝弱值(含两侧带空白)', () => {
  process.env.APP_ENV = 'production'
  try {
    for (const weak of WEAK_VALUES) {
      assert.throws(() => requireSecret('SECRET', weak), /SECRET/)
    }
    assert.throws(() => requireSecret('SECRET', '  default-secret  '), /SECRET/)
  } finally {
    delete process.env.APP_ENV
  }
})

test('requireSecret 生产接受强值', () => {
  process.env.APP_ENV = 'production'
  try {
    assert.equal(requireSecret('JWT_SECRET', 'a-very-long-random-secret'), 'a-very-long-random-secret')
  } finally {
    delete process.env.APP_ENV
  }
})

test('requireSecret 开发放行弱值但告警', () => {
  process.env.APP_ENV = 'development'
  const warnings: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')) }
  try {
    assert.equal(requireSecret('JWT_SECRET', 'default-secret'), 'default-secret')
  } finally {
    console.warn = original
    delete process.env.APP_ENV
  }
  assert.ok(warnings.some((w) => w.includes('JWT_SECRET')), '应打印包含变量名的告警')
})

test('corsOrigins 默认仅本机白名单', () => {
  delete process.env.CORS_ORIGINS
  assert.deepEqual(corsOrigins(), ['http://localhost:5173', 'http://127.0.0.1:5173'])
})

test('corsOrigins 解析逗号并去空白,永不含 *', () => {
  process.env.CORS_ORIGINS = ' https://a.example.com , https://b.example.com , '
  try {
    const origins = corsOrigins()
    assert.deepEqual(origins, ['https://a.example.com', 'https://b.example.com'])
    assert.ok(!origins.includes('*'))
  } finally {
    delete process.env.CORS_ORIGINS
  }
})
