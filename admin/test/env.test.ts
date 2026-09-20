import { test } from 'node:test'
import assert from 'node:assert/strict'

import { WEAK_VALUES, isProduction, requireSecret, corsOrigins, encryptionKey } from '../src/env.js'
import { encrypt, decrypt } from '../src/crypto-utils.js'

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

test('encryptionKey 生产缺失/弱值(含开发回退密钥)抛错', () => {
  process.env.APP_ENV = 'production'
  const saved = process.env.ENCRYPTION_KEY
  delete process.env.ENCRYPTION_KEY
  try {
    assert.throws(() => encryptionKey(undefined), /ENCRYPTION_KEY/)
    assert.throws(() => encryptionKey('default-key'), /ENCRYPTION_KEY/)
    assert.throws(() => encryptionKey('dev-only-insecure-encryption-key'), /ENCRYPTION_KEY/)
  } finally {
    delete process.env.APP_ENV
    if (saved === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = saved
  }
})

test('encryptionKey 开发缺失回退稳定开发密钥且加解密往返正常', () => {
  process.env.APP_ENV = 'development'
  const saved = process.env.ENCRYPTION_KEY
  delete process.env.ENCRYPTION_KEY
  const warnings: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')) }
  try {
    const k1 = encryptionKey()
    const k2 = encryptionKey()
    assert.equal(k1, k2, '开发回退密钥应进程内稳定')
    const token = encrypt('sk-secret-value', k1)
    assert.equal(decrypt(token, k2), 'sk-secret-value')
  } finally {
    console.warn = original
    delete process.env.APP_ENV
    if (saved === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = saved
  }
  assert.ok(warnings.some((w) => w.includes('ENCRYPTION_KEY')), '应打印含变量名的告警')
})
