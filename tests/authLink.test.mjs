import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthLinkError } from '../lib/authLink.js';

test('reads an expired-link error from the address hash', () => {
  const r = parseAuthLinkError('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  assert.deepEqual(r, { code: 'otp_expired', description: 'Email link is invalid or has expired' });
});

test('reads an error from the query string too', () => {
  assert.equal(parseAuthLinkError('?error=access_denied').code, 'access_denied');
});

test('no error for a good link or an empty address', () => {
  assert.equal(parseAuthLinkError('#access_token=abc&refresh_token=def&type=invite'), null);
  assert.equal(parseAuthLinkError(''), null);
  assert.equal(parseAuthLinkError(undefined), null);
});
