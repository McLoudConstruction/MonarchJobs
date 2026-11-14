import test from 'node:test';
import assert from 'node:assert/strict';
import { roomQuoteRows, quoteQuantity, fixedInRoom } from '../lib/sketchQuote.js';
import { emptyPlan, newRoom } from '../lib/sketch.js';

test('fixed cabinets and appliances come out of the room, loose items do not', () => {
  const p = { ...emptyPlan(), rooms: [{ ...newRoom('Kitchen', 0, 0, 12, 10), floor: 'tile' }, newRoom('Den', 20, 0, 10, 10)] };
  p.objects = [
    { id: 'a', t: 'island', x: 6, y: 5, r: 0, w: 6, d: 3 },        // 18
    { id: 'b', t: 'fridge', x: 1, y: 1, r: 0, w: 3, d: 2.5 },      // 7.5
    { id: 'c', t: 'box', x: 3, y: 3, r: 0, w: 3, d: 2 },           // other item: stays
    { id: 'd', t: 'base', x: 25, y: 5, r: 0, w: 3, d: 2 },         // in the den
    { id: 'e', t: 'door', x: 0, y: 5, r: 0, w: 3, d: 0.4 },        // not a floor footprint
  ];
  const rows = roomQuoteRows(p);
  assert.equal(rows[0].area, 120);
  assert.equal(rows[0].fixed, 25.5);
  assert.equal(rows[0].net, 94.5);
  assert.equal(rows[0].floor, 'Tile');
  assert.equal(rows[1].fixed, 6);
  assert.equal(fixedInRoom(p, p.rooms[0]).length, 2);
});

test('quantity: square feet use the net area, anything else is one', () => {
  const row = { area: 100, net: 90 };
  assert.equal(quoteQuantity('sqft', row), 90);
  assert.equal(quoteQuantity('sqft', row, false), 100);
  assert.equal(quoteQuantity('room', row), 1);
  assert.equal(quoteQuantity('flat', row), 1);
});

test('fixed objects never take more than 90% of a room', () => {
  const p = { ...emptyPlan(), rooms: [newRoom('Closet', 0, 0, 4, 4)] };
  p.objects = [{ id: 'a', t: 'builtin', x: 2, y: 2, r: 0, w: 10, d: 10 }];
  assert.equal(roomQuoteRows(p)[0].net, 1.6);
});
