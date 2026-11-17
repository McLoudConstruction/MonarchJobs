import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlan, ensureRoomNums, newRoom } from '../lib/sketch.js';
import { makeEquipment, pickUpUnit } from '../lib/equipment.js';
import { costSummary, equipmentRunTime, jobRevenue, laborTotals, parseHours, purchaseTotalCents, purchasesByCategory, timeEntryCents } from '../lib/jobCost.js';

const by = { id: 'u1', name: 'Sam' };
const days = [{ id: 'd1', date: '2026-11-10' }, { id: 'd2', date: '2026-11-11' }, { id: 'd3', date: '2026-11-12' }, { id: 'd4', date: '2026-11-13' }];
const base = () => ensureRoomNums({ ...emptyPlan(), days, rooms: [newRoom('Kitchen', 0, 0, 12, 10)] });
const withUnits = (units) => ({ ...base(), equipment: units });

test('equipment run time counts calendar days on site per kind of machine and prices them with the daily rate', () => {
  const am1 = makeEquipment('airmover', 1, 2, 2, { day: 'd1', by });
  const am2 = makeEquipment('airmover', 2, 3, 3, { day: 'd2', by });
  const dh = makeEquipment('dehu', 1, 4, 4, { day: 'd1', by });
  const plan = withUnits([am1, am2, dh]);
  const gone = pickUpUnit(plan, dh, { day: 'd4', by }); // placed Nov 10, picked up Nov 13 = 4 calendar days
  const rt = equipmentRunTime([{ id: 's', plan: { ...plan, equipment: [am1, am2, gone] } }], { airmover: 2500, dehu: 6000 });
  const am = rt.rows.find((r) => r.type === 'airmover');
  assert.deepEqual([am.units, am.unitDays, am.costCents], [2, 4 + 3, 7 * 2500]);
  const d = rt.rows.find((r) => r.type === 'dehu');
  assert.deepEqual([d.units, d.unitDays, d.costCents], [1, 4, 24000]);
  assert.equal(rt.unitDays, 11);
  assert.equal(rt.costCents, 17500 + 24000);
  assert.deepEqual(rt.missing, []);
});

test('a kind of machine with no daily rate costs nothing yet and is listed as missing', () => {
  const rt = equipmentRunTime([{ id: 's', plan: withUnits([makeEquipment('scrubber', 1, 2, 2, { day: 'd1', by })]) }], {});
  assert.equal(rt.rows[0].costCents, 0);
  assert.equal(rt.rows[0].unitDays, 4);
  assert.deepEqual(rt.missing, ['scrubber']);
  assert.equal(equipmentRunTime([], {}).rows.length, 0);
});

test('two sketches on one job add up', () => {
  const a = { id: 'a', plan: withUnits([makeEquipment('airmover', 1, 2, 2, { day: 'd1', by })]) };
  const b = { id: 'b', plan: withUnits([makeEquipment('airmover', 1, 2, 2, { day: 'd3', by })]) };
  const rt = equipmentRunTime([a, b], { airmover: 1000 });
  assert.equal(rt.rows[0].units, 2);
  assert.equal(rt.rows[0].unitDays, 4 + 2);
});

test('labor is hours times the rate the entry was made with, and voided rows never count', () => {
  const rows = [
    { hours: 3.5, rate_cents: 2500 },
    { hours: 2, rate_cents: 3000 },
    { hours: 8, rate_cents: 9999, voided_at: '2026-11-12T00:00:00Z' },
  ];
  assert.equal(timeEntryCents(rows[0]), 8750);
  assert.deepEqual(laborTotals(rows), { hours: 5.5, cents: 8750 + 6000 });
  assert.equal(purchaseTotalCents([{ amount_cents: 2599 }, { amount_cents: 1000, voided_at: 'x' }, { amount_cents: 401 }]), 3000);
  assert.deepEqual(purchasesByCategory([{ category: 'fuel', amount_cents: 500 }, { category: 'materials', amount_cents: 900 }, { category: 'fuel', amount_cents: 700 }]).map((r) => [r.category, r.cents]), [['fuel', 1200], ['materials', 900]]);
});

test('revenue is the newest invoice that is not void, else the approved estimate', () => {
  const inv = [
    { status: 'void', total_cents: 99999, created_at: '2026-11-10' },
    { status: 'paid', total_cents: 150000, created_at: '2026-11-11', invoice_number: 1002 },
    { status: 'sent', total_cents: 120000, created_at: '2026-11-09', invoice_number: 1001 },
  ];
  assert.deepEqual(jobRevenue(inv, 5), { cents: 150000, source: 'invoice', number: 1002 });
  assert.deepEqual(jobRevenue([], 80000), { cents: 80000, source: 'estimate' });
  assert.equal(jobRevenue([], null), null);
  assert.equal(jobRevenue([{ status: 'void', total_cents: 1 }], 0), null);
});

test('the summary adds purchases, labor and equipment and works out the margin', () => {
  const equipment = { costCents: 20000, unitDays: 8 };
  const s = costSummary({ purchases: [{ amount_cents: 10000 }], time: [{ hours: 4, rate_cents: 2500 }], equipment, revenue: { cents: 100000 } });
  assert.equal(s.totalCents, 10000 + 10000 + 20000);
  assert.equal(s.marginCents, 60000);
  assert.equal(s.marginPercent, 60);
  const none = costSummary({});
  assert.deepEqual([none.totalCents, none.marginCents, none.marginPercent], [0, null, null]);
});

test('hours can be typed several ways and bad input is refused', () => {
  assert.equal(parseHours('3.5'), 3.5);
  assert.equal(parseHours('3:30'), 3.5);
  assert.equal(parseHours('3h 30m'), 3.5);
  assert.equal(parseHours('2 hrs'), 2);
  assert.equal(parseHours('0'), null);
  assert.equal(parseHours('25'), null);
  assert.equal(parseHours('abc'), null);
  assert.equal(parseHours(''), null);
});
