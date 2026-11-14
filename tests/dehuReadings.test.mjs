import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDehuReading, cleanDehuReadings, depressionOf, depressionState, dehuHistory, lowDepressionUnits, addDehuReading, dropDehuDay } from '../lib/dehuReadings.js';
import { makeEquipment, cleanEquipment, dropEquipmentDay } from '../lib/equipment.js';

const plan = (eq) => ({ days: [{ id: 'd1', date: '2026-11-10' }, { id: 'd2', date: '2026-11-11' }], equipment: eq });
const uid = (v) => String(v || 'x');

test('a reading needs at least one full RH and temperature pair', () => {
  assert.equal(makeDehuReading({ day: 'd1', inRh: 60 }), null);
  assert.ok(makeDehuReading({ day: 'd1', inRh: 60, inTemp: 75 }));
  assert.equal(makeDehuReading({ day: 'd1', inRh: 140, inTemp: 75 }), null);
});

test('grain depression is inlet gpp minus outlet gpp', () => {
  const d = depressionOf({ inRh: 60, inTemp: 78, outRh: 25, outTemp: 92 });
  assert.ok(d.gin > 80 && d.gin < 90, String(d.gin));
  assert.ok(d.drop > 20 && d.drop < 60, String(d.drop));
  assert.equal(depressionOf({ inRh: 60, inTemp: 78 }).drop, null);
});

test('states: low under 5, fair, ok at 20+', () => {
  assert.equal(depressionState(3), 'low');
  assert.equal(depressionState(12), 'fair');
  assert.equal(depressionState(25), 'ok');
  assert.equal(depressionState(null), 'none');
});

test('low units are found from the latest reading only, dehumidifiers only', () => {
  let a = makeEquipment('dehu', 1, 0, 0, { day: 'd1' });
  a = addDehuReading(a, makeDehuReading({ day: 'd1', inRh: 60, inTemp: 78, outRh: 59, outTemp: 78 })); // no drop
  let b = makeEquipment('dehu', 2, 0, 0, { day: 'd1' });
  b = addDehuReading(b, makeDehuReading({ day: 'd1', inRh: 60, inTemp: 78, outRh: 59, outTemp: 78 }));
  b = addDehuReading(b, makeDehuReading({ day: 'd2', inRh: 60, inTemp: 78, outRh: 30, outTemp: 95 })); // recovered
  const f = makeEquipment('airmover', 1, 0, 0, { day: 'd1' });
  const low = lowDepressionUnits(plan([a, b, f]));
  assert.deepEqual(low.map((x) => x.u.n), [1]);
  assert.equal(dehuHistory(plan([b]), b).length, 2);
});

test('readings survive cleaning and go with a deleted day', () => {
  let a = makeEquipment('dehu', 1, 0, 0, { day: 'd1' });
  a = addDehuReading(a, makeDehuReading({ day: 'd1', inRh: 60, inTemp: 78, outRh: 40, outTemp: 90 }));
  a = addDehuReading(a, makeDehuReading({ day: 'd2', inRh: 55, inTemp: 78, outRh: 35, outTemp: 90 }));
  const kept = cleanEquipment([a], uid, new Set(['d1', 'd2']));
  assert.equal(kept[0].dr.length, 2);
  assert.equal(cleanEquipment([a], uid, new Set(['d1']))[0].dr.length, 1);
  assert.equal(dropEquipmentDay([a], 'd2')[0].dr.length, 1);
  assert.equal(dropDehuDay([a], 'd1')[0].dr.length, 1);
});
