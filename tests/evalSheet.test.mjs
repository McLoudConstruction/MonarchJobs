import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEval, blankEval, evalLines, evalTotal, evalTitle, evalJobTotal, ADDONS, SIZES } from '../lib/evalSheet.js';

test('a blank sheet totals nothing and has every add-on off', () => {
  const d = blankEval({ complex: 'Oak Park' });
  assert.equal(d.complex, 'Oak Park');
  assert.equal(evalTotal(d), 0);
  assert.equal(Object.keys(d.services).length, ADDONS.length);
  assert.ok(Object.values(d.services).every((s) => !s.on));
});

test('bedroom prices match the printed sheet', () => {
  assert.deepEqual(SIZES.map((s) => s.price), [60, 80, 100, 120]);
  for (const s of SIZES) assert.equal(evalTotal({ size: s.key }), s.price);
});

test('additional rooms are $25 each', () => {
  assert.equal(evalTotal({ size: '2', extra_rooms: 3 }), 80 + 75);
});

test('add-ons multiply quantity by price, only when ticked', () => {
  const d = {
    size: '1',
    services: {
      prevac: { on: true, qty: 3 },       // 3 rooms x $10
      red_stain: { on: true, qty: 4 },    // 4 spots x $15
      urine: { on: false, qty: 2 },       // off: ignored
      smoke: { on: true },                // flat $75, quantity defaults to 1
    },
  };
  assert.equal(evalTotal(d), 60 + 30 + 60 + 75);
});

test('ranged add-ons use the price entered, defaulting to the low end', () => {
  assert.equal(evalTotal({ services: { stretch: { on: true, qty: 2 } } }), 100);          // 2 x $50
  assert.equal(evalTotal({ services: { stretch: { on: true, qty: 2, price: 75 } } }), 150); // 2 x $75
  assert.equal(evalTotal({ services: { patch: { on: true, qty: 1, price: 180 } } }), 180);  // "150+" can exceed
});

test('other lines add their own amount and need to be ticked', () => {
  const d = { others: [{ on: true, label: 'Pet treatment', amount: 40 }, { on: false, label: 'x', amount: 99 }] };
  assert.equal(evalTotal(d), 40);
  assert.deepEqual(evalLines(d).map((l) => l.label), ['Pet treatment']);
});

test('cleanEval rejects junk: bad size, negative or huge numbers, bad date, non-string photo ids', () => {
  const d = cleanEval({ size: '9', extra_rooms: -4, date: 'tomorrow', photo_ids: ['a', 5, null], services: { prevac: { on: true, qty: 5000, price: -1 } } });
  assert.equal(d.size, '');
  assert.equal(d.extra_rooms, 0);
  assert.equal(d.date, '');
  assert.deepEqual(d.photo_ids, ['a']);
  assert.equal(d.services.prevac.qty, 99);
  assert.equal(d.services.prevac.price, 0);
  assert.equal(cleanEval(null).others.length, 2);
});

test('money is rounded to cents', () => {
  assert.equal(evalTotal({ others: [{ on: true, label: 'a', amount: 10.004 }, { on: true, label: 'b', amount: 0.1 }] }), 10.1);
});

test('title and job total', () => {
  assert.equal(evalTitle({ building: 'B12', unit: '204', size: '2' }), 'Bldg B12 / Unit 204 - 2 Bedroom');
  assert.equal(evalTitle({}), 'New sheet');
  assert.equal(evalJobTotal([{ data: { size: '1' } }, { data: { size: '3', extra_rooms: 1 } }]), 60 + 125);
});
