import test from 'node:test';
import assert from 'node:assert/strict';
import { stockStatus, cleanTruck, cleanItem, cleanQty, lowList, qtyText } from '../lib/truckStock.js';

test('status: out, low, ok, and no level set means never low', () => {
  assert.equal(stockStatus(0, 2), 'out');
  assert.equal(stockStatus(2, 2), 'low');
  assert.equal(stockStatus(2.5, 2), 'ok');
  assert.equal(stockStatus(0, 0), 'ok');
});

test('truck needs a name and drops blanks and repeats', () => {
  assert.ok(cleanTruck({ name: '  ' }).error);
  assert.deepEqual(cleanTruck({ name: ' Truck 1 ', tech_ids: ['a', 'a', '', 'b'] }).value, { name: 'Truck 1', tech_ids: ['a', 'b'] });
});

test('supply fields are checked and rounded', () => {
  assert.ok(cleanItem({ name: '' }).error);
  assert.ok(cleanItem({ name: 'x', per_visit: -1 }).error);
  assert.ok(cleanItem({ name: 'x', low_at: 'abc' }).error);
  assert.deepEqual(cleanItem({ name: 'Spotter', unit: 'bottles', per_visit: '1.256', low_at: '2' }).value, { name: 'Spotter', unit: 'bottles', per_visit: 1.26, low_at: 2 });
  assert.deepEqual(cleanItem({ name: 'Wipes' }).value, { name: 'Wipes', unit: '', per_visit: 0, low_at: 0 });
});

test('a typed count', () => {
  assert.ok(cleanQty('').error); assert.ok(cleanQty('-1').error); assert.ok(cleanQty('abc').error);
  assert.equal(cleanQty('0').value, 0);
  assert.equal(cleanQty('12.5').value, 12.5);
});

test('low list is emptiest first and skips retired supplies', () => {
  const trucks = [{ id: 't1', name: 'Truck 1' }];
  const items = [{ id: 'i1', name: 'A', unit: '', low_at: 2, active: true }, { id: 'i2', name: 'B', unit: '', low_at: 5, active: true }, { id: 'i3', name: 'C', unit: '', low_at: 5, active: false }];
  const stock = [{ truck_id: 't1', item_id: 'i1', qty: 2 }, { truck_id: 't1', item_id: 'i2', qty: 0 }, { truck_id: 't1', item_id: 'i3', qty: 0 }];
  assert.deepEqual(lowList(trucks, items, stock).map((x) => [x.item, x.status]), [['B', 'out'], ['A', 'low']]);
});

test('quantity text', () => { assert.equal(qtyText(3, 'rolls'), '3 rolls'); assert.equal(qtyText(2, ''), '2'); });
