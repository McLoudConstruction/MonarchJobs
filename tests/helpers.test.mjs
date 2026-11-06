import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyStripeSignature, verifySquareSignature } from '../lib/webhookSignatures.js';

test('stripe signature accepts a valid header and rejects tampering/old timestamps', () => {
  const secret = 'whsec_test';
  const body = '{"id":"evt_1"}';
  const t = 1700000000;
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const header = `t=${t},v1=${v1}`;
  assert.equal(verifyStripeSignature(body, header, secret, 300, t + 10), true);
  assert.equal(verifyStripeSignature(body + 'x', header, secret, 300, t + 10), false);
  assert.equal(verifyStripeSignature(body, header, secret, 300, t + 1000), false);
  assert.equal(verifyStripeSignature(body, header, 'other', 300, t + 10), false);
  assert.equal(verifyStripeSignature(body, null, secret), false);
});

test('square signature accepts valid and rejects wrong url/body', () => {
  const key = 'sigkey';
  const url = 'https://example.com/api/webhooks/square';
  const body = '{"event_id":"e1"}';
  const sig = crypto.createHmac('sha256', key).update(url + body).digest('base64');
  assert.equal(verifySquareSignature(body, sig, key, url), true);
  assert.equal(verifySquareSignature(body, sig, key, url + '/'), false);
  assert.equal(verifySquareSignature(body + ' ', sig, key, url), false);
  assert.equal(verifySquareSignature(body, '', key, url), false);
});
