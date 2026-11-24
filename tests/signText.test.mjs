import test from 'node:test';
import assert from 'node:assert/strict';
import { signText, signKindOk, SIGN_KINDS } from '../lib/signText.js';

test('only the two documents can be signed by link', () => {
  assert.equal(signKindOk('authorization'), true);
  assert.equal(signKindOk('certificate'), true);
  assert.equal(signKindOk('safety'), false);
  assert.equal(signKindOk('__proto__'), false);
  assert.ok(SIGN_KINDS.authorization.title && SIGN_KINDS.certificate.button);
});

test('the wording names the company and the address, and never assigns insurance benefits', () => {
  for (const k of ['authorization', 'certificate']) {
    const text = signText(k, { business: 'Monarch Cleaning', address: '12 Oak St, Springfield', customer: 'Pat Lee' }).join(' ');
    assert.match(text, /Monarch Cleaning/);
    assert.match(text, /12 Oak St/);
    assert.doesNotMatch(text, /assign/i);
  }
});
