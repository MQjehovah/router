import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { WEAK_VALUES, isProduction, requireSecret, corsOrigins } from '../src/env.js'
import { buildApp } from '../src/app.js'

// .env.example 中名称含 SECRET/PASSWORD/KEY/TOKEN 的变量视为秘密;
// 其占位符必须全部命中 WEAK_VALUES,否则复制模板即绕过生产守卫。
const ENV_EXAMPLE_PATH = fileURLToPath(new URL('../../.env.example', import.meta.url))

function secretEnvPlaceholders(): Array<{ name: string; value: string }> {
  return readFileSync(ENV_EXAMPLE_PATH, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .flatMap((line) => {
      const eq = line.indexOf('=')
      if (eq <= 0) return []
      const name = line.slice(0, eq).trim()
      const value = line.slice(eq + 1).trim()
      return /(SECRET|PASSWORD|KEY|TOKEN)/i.test(name) ? [{ name, value }] : []
    })
}

test('.env.example 的秘密占位符在 production 下全部被拒绝', () => {
  const saved = process.env.APP_ENV
  process.env.APP_ENV = 'production'
  try {
    const placeholders = secretEnvPlaceholders()
    assert.ok(placeholders.length > 0, '.env.example 应至少包含一个秘密变量占位符')
    for (const { name, value } of placeholders) {
      assert.throws(
        () => requireSecret(name, value),
        new RegExp(name),
        `${name}=${value} 应在 production 下被拒绝`
      )
    }
  } finally {
    if (saved === undefined) delete process.env.APP_ENV
    else process.env.APP_ENV = saved
  }
})

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

// buildApp 是网关的启动入口构造:生产环境缺/弱 INTERNAL_SECRET 必须在此拒绝,
// 早于 listen 失败;开发环境放行并告警。
test('buildApp 生产环境缺失/弱 INTERNAL_SECRET 时拒绝启动并指出变量名', async () => {
  const savedAppEnv = process.env.APP_ENV
  const savedSecret = process.env.INTERNAL_SECRET
  process.env.APP_ENV = 'production'
  try {
    delete process.env.INTERNAL_SECRET
    await assert.rejects(() => buildApp(), /INTERNAL_SECRET/)
    process.env.INTERNAL_SECRET = 'change-me'
    await assert.rejects(() => buildApp(), /INTERNAL_SECRET/)
  } finally {
    if (savedAppEnv === undefined) delete process.env.APP_ENV
    else process.env.APP_ENV = savedAppEnv
    if (savedSecret === undefined) delete process.env.INTERNAL_SECRET
    else process.env.INTERNAL_SECRET = savedSecret
  }
})

test('buildApp 开发环境弱 INTERNAL_SECRET 放行并告警', async () => {
  const savedAppEnv = process.env.APP_ENV
  const savedSecret = process.env.INTERNAL_SECRET
  const warnings: string[] = []
  const original = console.warn
  let app: Awaited<ReturnType<typeof buildApp>> | undefined
  process.env.APP_ENV = 'development'
  process.env.INTERNAL_SECRET = 'change-me'
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')) }
  try {
    app = await buildApp()
  } finally {
    console.warn = original
    if (savedAppEnv === undefined) delete process.env.APP_ENV
    else process.env.APP_ENV = savedAppEnv
    if (savedSecret === undefined) delete process.env.INTERNAL_SECRET
    else process.env.INTERNAL_SECRET = savedSecret
  }
  assert.ok(warnings.some((w) => w.includes('INTERNAL_SECRET')), '应打印包含变量名的告警')
  await app?.close()
})

test('buildApp 生产环境强 INTERNAL_SECRET 正常启动', async () => {
  const savedAppEnv = process.env.APP_ENV
  const savedSecret = process.env.INTERNAL_SECRET
  process.env.APP_ENV = 'production'
  process.env.INTERNAL_SECRET = 'a-strong-random-internal-secret'
  try {
    const app = await buildApp()
    await app.close()
  } finally {
    if (savedAppEnv === undefined) delete process.env.APP_ENV
    else process.env.APP_ENV = savedAppEnv
    if (savedSecret === undefined) delete process.env.INTERNAL_SECRET
    else process.env.INTERNAL_SECRET = savedSecret
  }
})
