import test from 'node:test';
import assert from 'node:assert/strict';

process.env.INTEGRATION_ENCRYPTION_KEY = 'a'.repeat(64);
const { encryptJson, decryptJson } = await import('../lib/crypto.js');

test('encrypt/decrypt round trip, unique ciphertext, tamper detection', () => {
  const obj = { secret_key: 'sk_test_123', webhook_secret: 'whsec_abc' };
  const a = encryptJson(obj);
  const b = encryptJson(obj);
  assert.notEqual(a, b);
  assert.deepEqual(decryptJson(a), obj);
  assert.ok(!a.includes('sk_test_123'));
  const parts = a.split('.');
  parts[2] = Buffer.from('tampered').toString('base64');
  assert.throws(() => decryptJson(parts.join('.')));
});

test('rejects a bad key', async () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = 'short';
  assert.throws(() => encryptJson({ a: 1 }), /64 hex/);
});
