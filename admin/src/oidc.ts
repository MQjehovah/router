import { webcrypto } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

// jose 依赖 Web Crypto(globalThis.crypto.subtle);node:18 默认未暴露,补全局垫片
if (!globalThis.crypto) {
  (globalThis as { crypto: unknown }).crypto = webcrypto;
}

interface Discovery {
  issuer: string;
  jwks_uri: string;
}

let discoveryCache: { value: Discovery; expiresAt: number } | null = null;
let remoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let remoteJwksUri: string | null = null;

const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export function isOidcConfigured(): boolean {
  return Boolean(process.env.OIDC_ISSUER && process.env.OIDC_AUDIENCE);
}

async function discover(issuer: string): Promise<Discovery> {
  const now = Date.now();
  if (discoveryCache && discoveryCache.expiresAt > now) {
    return discoveryCache.value;
  }

  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed: ${response.status}`);
  }
  const doc = (await response.json()) as Discovery;
  if (doc.issuer !== issuer) {
    throw new Error(`OIDC issuer mismatch: expected ${issuer}, got ${doc.issuer}`);
  }
  discoveryCache = { value: doc, expiresAt: now + DISCOVERY_TTL_MS };
  return doc;
}

async function getJwksFetcher(): Promise<ReturnType<typeof createRemoteJWKSet>> {
  const directUri = process.env.OIDC_JWKS_URI;
  const issuer = process.env.OIDC_ISSUER!;
  const jwksUri = directUri || (await discover(issuer)).jwks_uri;

  if (!remoteJwks || remoteJwksUri !== jwksUri) {
    remoteJwks = createRemoteJWKSet(new URL(jwksUri));
    remoteJwksUri = jwksUri;
  }
  return remoteJwks;
}

/// 校验 IdP 签发的 ID Token（签名、iss、aud、exp），返回 payload
export async function verifyIdToken(idToken: string): Promise<JWTPayload> {
  if (!isOidcConfigured()) {
    throw new Error('OIDC not configured');
  }

  const jwks = await getJwksFetcher();
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: process.env.OIDC_ISSUER,
    audience: process.env.OIDC_AUDIENCE,
    clockTolerance: 30
  });
  return payload;
}

/// 从 payload 提取工号：优先取配置的 claim（OIDC_EMPLOYEE_ID_CLAIM），再尝试常见命名
export function extractEmployeeId(payload: JWTPayload): string | null {
  const candidates = [
    process.env.OIDC_EMPLOYEE_ID_CLAIM,
    'employee_number',
    'employeeNumber',
    'employee_id',
    'employeeId',
    'emp_no',
    'empNo',
    'job_number'
  ].filter((name): name is string => Boolean(name));

  for (const name of candidates) {
    const value = payload[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}
