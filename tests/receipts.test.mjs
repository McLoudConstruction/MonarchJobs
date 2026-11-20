import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptPathFor, receiptBelongsToJob, checkReceiptBlob, RECEIPT_MAX_BYTES } from '../lib/receipts.js';

const J = '11111111-1111-4111-8111-111111111111';
const U = '22222222-2222-4222-8222-222222222222';

test('receipt paths live in the job folder and belong only to that job', () => {
  const p = receiptPathFor(J, U);
  assert.equal(p, `${J}/${U}.jpg`);
  assert.equal(receiptBelongsToJob(p, J), true);
  assert.equal(receiptBelongsToJob(p, '33333333-3333-4333-8333-333333333333'), false);
  assert.equal(receiptBelongsToJob(`${J}/../x.jpg`, J), false);
  assert.equal(receiptBelongsToJob(null, J), false);
});

test('receipt pictures must arrive and be a sensible size', () => {
  assert.match(checkReceiptBlob(null), /did not come through/);
  assert.match(checkReceiptBlob({ size: 0 }), /did not come through/);
  assert.match(checkReceiptBlob({ size: RECEIPT_MAX_BYTES + 1 }), /too large/);
  assert.equal(checkReceiptBlob({ size: 500000 }), null);
});
