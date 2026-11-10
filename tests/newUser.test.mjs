import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNewUser, validateName } from '../lib/newUser.js';

const good = { email: ' Pat.Lee@Example.com ', full_name: '  Pat   Lee ', role: 'tech', password: 'longenough1' };

test('cleans and accepts a complete new user', () => {
  const r = validateNewUser(good);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.value, { email: 'pat.lee@example.com', full_name: 'Pat Lee', role: 'tech', password: 'longenough1' });
});

test('requires a real name', () => {
  assert.match(validateNewUser({ ...good, full_name: '  ' }).error, /name/i);
  assert.match(validateNewUser({ ...good, full_name: 'pat@example.com' }).error, /not an email/i);
});

test('requires a valid email, role and password', () => {
  assert.match(validateNewUser({ ...good, email: 'nope' }).error, /email/i);
  assert.match(validateNewUser({ ...good, role: 'admin' }).error, /role/i);
  assert.match(validateNewUser({ ...good, password: 'short' }).error, /at least/);
});

test('validateName trims and rejects blanks and emails', () => {
  assert.equal(validateName('  Sam  Ray ').value, 'Sam Ray');
  assert.ok(validateName('').error);
  assert.ok(validateName('sam@x.com').error);
});
