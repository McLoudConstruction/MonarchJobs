import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNewPassword, MIN_PASSWORD_LENGTH } from '../lib/passwordRules.js';

test('rejects short or empty passwords', () => {
  assert.match(checkNewPassword('', ''), /at least/);
  assert.match(checkNewPassword('short', 'short'), /at least/);
  assert.match(checkNewPassword(undefined, undefined), /at least/);
});

test('rejects mismatched confirmation', () => {
  assert.match(checkNewPassword('longenough1', 'longenough2'), /do not match/);
});

test('accepts a matching password at the minimum length', () => {
  const pw = 'x'.repeat(MIN_PASSWORD_LENGTH);
  assert.equal(checkNewPassword(pw, pw), '');
});
