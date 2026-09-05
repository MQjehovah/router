import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../src/crypto-utils.js';
import { extractEmployeeId, isOidcConfigured } from '../src/oidc.js';

test('crypto-utils: encrypt/decrypt roundtrip', () => {
  const key = '0123456789abcdef0123456789abcdef';
  const raw = 'sk-abc123';
  assert.equal(decrypt(encrypt(raw, key), key), raw);
});

test('crypto-utils: encrypt output uses iv:cipher hex format', () => {
  const key = '0123456789abcdef0123456789abcdef';
  const out = encrypt('sk-abc123', key);
  const parts = out.split(':');
  assert.equal(parts.length, 2);
  assert.match(parts[0], /^[0-9a-f]{32}$/);
  assert.match(parts[1], /^[0-9a-f]+$/);
});

test('extractEmployeeId: prefers configured claim', () => {
  process.env.OIDC_EMPLOYEE_ID_CLAIM = 'staff_no';
  try {
    const id = extractEmployeeId({ staff_no: 'E001', employee_number: 'E002' });
    assert.equal(id, 'E001');
  } finally {
    delete process.env.OIDC_EMPLOYEE_ID_CLAIM;
  }
});

test('extractEmployeeId: falls back to common claim names', () => {
  assert.equal(extractEmployeeId({ employee_number: '1001' }), '1001');
  assert.equal(extractEmployeeId({ employeeNumber: 1002 }), '1002');
});

test('extractEmployeeId: returns null when no claim matches', () => {
  assert.equal(extractEmployeeId({ sub: 'abc', email: 'a@b.c' }), null);
});

test('extractEmployeeId: ignores empty or whitespace-only claim values', () => {
  process.env.OIDC_EMPLOYEE_ID_CLAIM = 'staff_no';
  try {
    assert.equal(extractEmployeeId({ staff_no: '   ' }), null);
  } finally {
    delete process.env.OIDC_EMPLOYEE_ID_CLAIM;
  }
});

test('isOidcConfigured: requires issuer and audience', () => {
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_AUDIENCE;
  assert.equal(isOidcConfigured(), false);
  process.env.OIDC_ISSUER = 'https://idp.example.com';
  assert.equal(isOidcConfigured(), false);
  process.env.OIDC_AUDIENCE = 'router-admin';
  assert.equal(isOidcConfigured(), true);
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_AUDIENCE;
});
