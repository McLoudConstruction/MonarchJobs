import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTotals, lineCents } from '../lib/estimate.js';

const L = (q, p) => ({ quantity: q, unit_price: p });

test('line math rounds to the cent without float drift', () => {
  assert.equal(lineCents(L(3, 0.1)), 30);          // 0.1 * 3 is 0.30000000000000004 in floats
  assert.equal(lineCents(L(350, 0.3)), 10500);
  assert.equal(lineCents(L(1.5, 19.99)), 2999);    // exactly 29.985: half a cent rounds up to 29.99
  assert.equal(lineCents(L(1.5, -19.99)), -2999);  // and away from zero for credits
  assert.equal(lineCents(L(0.333, 10)), 333);
});

test('minimum tops up a small subtotal once, for the whole job', () => {
  const lines = [L(100, 0.25), L(1, 40)]; // 25 + 40 = 65
  assert.deepEqual(estimateTotals(lines, 120), { subtotalCents: 6500, minimumAdjustmentCents: 5500, totalCents: 12000 });
});

test('no adjustment when the subtotal already meets the minimum', () => {
  assert.deepEqual(estimateTotals([L(500, 0.3)], 120), { subtotalCents: 15000, minimumAdjustmentCents: 0, totalCents: 15000 });
  assert.deepEqual(estimateTotals([L(400, 0.3)], 120), { subtotalCents: 12000, minimumAdjustmentCents: 0, totalCents: 12000 });
});

test('empty estimate stays at zero even with a minimum', () => {
  assert.deepEqual(estimateTotals([], 120), { subtotalCents: 0, minimumAdjustmentCents: 0, totalCents: 0 });
});

test('discount lines reduce the subtotal and the minimum can still apply', () => {
  const lines = [L(300, 0.5), L(1, -100)]; // 150 - 100 = 50, below the 120 minimum
  assert.deepEqual(estimateTotals(lines, 120), { subtotalCents: 5000, minimumAdjustmentCents: 7000, totalCents: 12000 });
  assert.equal(estimateTotals([L(1, -50)], 120).totalCents, -5000); // credit-only estimate is not topped up
});
