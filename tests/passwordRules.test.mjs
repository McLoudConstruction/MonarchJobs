import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNewPassword, passwordRequirements, MIN_PASSWORD_LENGTH } from '../lib/passwordRules.js';

test('rejects short or empty passwords', () => {
  assert.match(checkNewPassword('', ''), /at least 8/);
  assert.match(checkNewPassword('Ab1!', 'Ab1!'), /at least 8/);
  assert.match(checkNewPassword(undefined, undefined), /at least 8/);
});

test('each requirement is enforced with its own message', () => {
  assert.match(checkNewPassword('lowercase1!', 'lowercase1!'), /capital/);
  assert.match(checkNewPassword('UPPERCASE1!', 'UPPERCASE1!'), /lowercase/);
  assert.match(checkNewPassword('NoNumbers!!', 'NoNumbers!!'), /number/);
  assert.match(checkNewPassword('NoSymbols12', 'NoSymbols12'), /symbol/);
  assert.match(checkNewPassword('three blue ducks', 'three blue ducks'), /capital/);
});

test('the checklist reports which requirements are met', () => {
  const met = (pw) => Object.fromEntries(passwordRequirements(pw).map((r) => [r.id, r.met]));
  assert.deepEqual(met(''), { length: false, upper: false, lower: false, number: false, symbol: false });
  assert.deepEqual(met('Abcdefg1'), { length: true, upper: true, lower: true, number: true, symbol: false });
  assert.deepEqual(met('Blue#Fox7'), { length: true, upper: true, lower: true, number: true, symbol: true });
});

test('rejects passwords that meet the checklist but are easy to guess', () => {
  assert.match(checkNewPassword('Password1!', 'Password1!'), /easy to guess/);
  assert.match(checkNewPassword('Qwerty123!', 'Qwerty123!'), /easy to guess/);
});

test('rejects a password built from the person\'s own email or name', () => {
  const ctx = ['pat.lee@example.com', 'Pat Lee'];
  assert.match(checkNewPassword('Pat.Lee-2026!', 'Pat.Lee-2026!', ctx), /easy to guess/);
  assert.equal(checkNewPassword('Pat.Lee-2026!', 'Pat.Lee-2026!'), ''); // fine for someone else
});

test('rejects two passwords that differ', () => {
  assert.match(checkNewPassword('Tr1cky-Horse', 'Tr1cky-Horsf'), /do not match/);
});

test('accepts a matching password that meets every requirement', () => {
  assert.ok(MIN_PASSWORD_LENGTH <= 8);
  assert.equal(checkNewPassword('Blue#Fox7', 'Blue#Fox7'), '');
  assert.equal(checkNewPassword('Three-blue-ducks-4', 'Three-blue-ducks-4'), '');
});
