import test from 'node:test';
import assert from 'node:assert/strict';
import { rateMap, priceFor, isCustomRate, cleanRate, rateChanges } from '../lib/propertyRates.js';

const item = (id, price) => ({ id, price });

test('a property rate replaces the standard price; no rate keeps it', () => {
  const rates = rateMap([{ price_item_id: 'a', unit_price: '0.18' }, { price_item_id: 'b', unit_price: 0 }]);
  assert.equal(priceFor(item('a', 0.25), rates), 0.18);
  assert.equal(priceFor(item('b', 40), rates), 0, 'a free line is a real rate');
  assert.equal(priceFor(item('c', 12.5), rates), 12.5);
  assert.equal(priceFor(item('c', 12.5), new Map()), 12.5);
  assert.equal(priceFor(item('c', '12.50'), undefined), 12.5);
});

test('bad rows are ignored when the map is built', () => {
  const m = rateMap([{ price_item_id: 'a', unit_price: 'x' }, { price_item_id: '', unit_price: 5 }, { price_item_id: 'd', unit_price: -1 }, { price_item_id: 'e', unit_price: 3 }]);
  assert.deepEqual([...m], [['e', 3]]);
});

test('a rate is "custom" only when it differs from the standard price', () => {
  const rates = rateMap([{ price_item_id: 'a', unit_price: 0.18 }, { price_item_id: 'b', unit_price: 40 }]);
  assert.equal(isCustomRate(item('a', 0.25), rates), true);
  assert.equal(isCustomRate(item('b', 40), rates), false);
  assert.equal(isCustomRate(item('c', 5), rates), false);
});

test('what is typed in a rate box', () => {
  assert.deepEqual(cleanRate(''), { value: null });
  assert.deepEqual(cleanRate('  '), { value: null });
  assert.deepEqual(cleanRate('$12.5'), { value: 12.5 });
  assert.deepEqual(cleanRate('0'), { value: 0 });
  assert.deepEqual(cleanRate('7'), { value: 7 });
  for (const bad of ['abc', '-3', '1.234', '1,5', '12.', '999999']) assert.ok(cleanRate(bad).error, `${bad} is refused`);
});

test('applying rates to an estimate only changes catalog lines whose price differs', () => {
  const rates = rateMap([{ price_item_id: 'a', unit_price: 0.18 }, { price_item_id: 'b', unit_price: 40 }]);
  const lines = [
    { id: 1, price_item_id: 'a', unit_price: '0.25', is_custom: false },
    { id: 2, price_item_id: 'b', unit_price: '40.00', is_custom: false },
    { id: 3, price_item_id: 'a', unit_price: '9.99', is_custom: true },   // typed by hand: left alone
    { id: 4, price_item_id: null, unit_price: '5', is_custom: false },
    { id: 5, price_item_id: 'z', unit_price: '5', is_custom: false },     // no rate for it
  ];
  assert.deepEqual(rateChanges(lines, rates), [{ id: 1, from: 0.25, to: 0.18 }]);
  assert.deepEqual(rateChanges(lines, new Map()), []);
  assert.deepEqual(rateChanges(lines, undefined), []);
});
