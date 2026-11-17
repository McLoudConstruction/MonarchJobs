import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNewUser, validateName, inviteErrorMessage, deleteBlockReason } from '../lib/newUser.js';

const good = { email: ' Pat.Lee@Example.com ', full_name: '  Pat   Lee ', role: 'tech' };

test('cleans and accepts a complete new user', () => {
  const r = validateNewUser(good);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.value, { email: 'pat.lee@example.com', full_name: 'Pat Lee', role: 'tech' });
});

test('requires a real name', () => {
  assert.match(validateNewUser({ ...good, full_name: '  ' }).error, /name/i);
  assert.match(validateNewUser({ ...good, full_name: 'pat@example.com' }).error, /not an email/i);
});

test('requires a valid email and role, and takes no password', () => {
  assert.match(validateNewUser({ ...good, email: 'nope' }).error, /email/i);
  assert.match(validateNewUser({ ...good, role: 'admin' }).error, /role/i);
  // a password sent along is ignored, never passed on
  assert.equal(validateNewUser({ ...good, password: 'sneaky-password-1' }).value.password, undefined);
});

test('inviteErrorMessage explains the common Supabase email errors', () => {
  assert.deepEqual(inviteErrorMessage({ code: 'email_exists', message: 'A user with this email address has already been registered' }), { message: 'That email already has an account.', status: 409 });
  const rate = inviteErrorMessage({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' });
  assert.equal(rate.status, 429);
  assert.match(rate.message, /email limit/i);
  assert.deepEqual(inviteErrorMessage({ message: 'Something odd' }), { message: 'Something odd', status: 400 });
  assert.equal(inviteErrorMessage(null).status, 400);
});

test('validateName trims and rejects blanks and emails', () => {
  assert.equal(validateName('  Sam  Ray ').value, 'Sam Ray');
  assert.ok(validateName('').error);
  assert.ok(validateName('sam@x.com').error);
});

import { needsPasswordChange } from '../lib/newUser.js';

test('needsPasswordChange only when the flag is true', () => {
  assert.equal(needsPasswordChange({ user_metadata: { must_change_password: true } }), true);
  assert.equal(needsPasswordChange({ user_metadata: { must_change_password: false } }), false);
  assert.equal(needsPasswordChange({ user_metadata: {} }), false);
  assert.equal(needsPasswordChange(null), false);
});

test('deleteBlockReason: only deactivated people or unaccepted invites can be deleted, never yourself', () => {
  assert.match(deleteBlockReason({ isSelf: true, active: false, confirmed: true }), /your own/);
  assert.match(deleteBlockReason({ isSelf: false, active: true, confirmed: true }), /Deactivate this person first/);
  assert.equal(deleteBlockReason({ isSelf: false, active: false, confirmed: true }), '');
  assert.equal(deleteBlockReason({ isSelf: false, active: true, confirmed: false }), ''); // invite never accepted
});
