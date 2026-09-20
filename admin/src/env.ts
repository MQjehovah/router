/** 环境分级的安全配置守卫(与平台其他服务保持同一约定)。 */

/** 跨仓库统一的弱值清单:生产环境命中即拒绝启动。 */
export const WEAK_VALUES = new Set([
  'change-me-in-production',
  'dev-secret-change-me-please-32-bytes-minimum',
  'default-secret',
  'default-key',
  'dev-only-insecure-encryption-key',
  'xzyz2022!',
  'admin123',
  '123456',
  'change-me',
  'gateway-secret',
  'agent-secret',
  'your-secret-key'
])

/** APP_ENV 默认 development;production/prod(大小写不敏感)视为生产。 */
export function isProduction(): boolean {
  const v = (process.env.APP_ENV ?? 'development').trim().toLowerCase()
  return v === 'production' || v === 'prod'
}

/** 校验秘密类配置:生产拒绝弱值/空值(报错含变量名),开发放行并告警。 */
export function requireSecret(name: string, value: string | undefined): string {
  const normalized = (value ?? '').trim()
  const bad = normalized === '' || WEAK_VALUES.has(normalized)
  if (!bad) return value as string
  if (isProduction()) {
    throw new Error(`环境变量 ${name} 未配置或仍为不安全的默认值,请参考 .env.example 设置`)
  }
  console.warn(`[env] ${name} 使用默认/弱值;生产环境(APP_ENV=production)将拒绝启动`)
  return value as string
}

/** 开发态加密密钥回退:固定 32 字节,仅保证 development 下加/解密往返自洽;生产缺失/弱值一律抛错。 */
export const DEV_ENCRYPTION_KEY = 'dev-only-insecure-encryption-key'

/** 解析 ENCRYPTION_KEY:生产缺失/弱值抛错(含开发回退密钥);开发缺失/弱值时回退开发密钥并告警。 */
export function encryptionKey(value: string | undefined = process.env.ENCRYPTION_KEY): string {
  const normalized = (value ?? '').trim()
  if (!isProduction() && (normalized === '' || WEAK_VALUES.has(normalized))) {
    console.warn('[env] ENCRYPTION_KEY 未配置或为弱值, 开发环境回退到开发密钥(切勿用于生产)')
    return DEV_ENCRYPTION_KEY
  }
  return requireSecret('ENCRYPTION_KEY', value)
}

/** 按逗号解析 CORS 白名单;默认仅本机(永不含 *)。 */
export function corsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173'
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}
