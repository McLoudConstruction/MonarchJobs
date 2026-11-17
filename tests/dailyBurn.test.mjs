import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlan, normalizePlan } from '../lib/sketch.js';
import { dailyBurn } from '../lib/dailyBurn.js';
import { renderDailyBurn } from '../lib/dailyBurnReport.js';

const plan = normalizePlan({
  ...emptyPlan(),
  days: [{ id: 'd1', date: '2026-11-10' }, { id: 'd2', date: '2026-11-12' }, { id: 'd3', date: '2026-11-13' }],
  equipment: [
    { id: 'u1', t: 'dehu', n: 1, log: [{ id: 'l1', action: 'placed', day: 'd1', x: 1, y: 1 }, { id: 'l2', action: 'removed', day: 'd3', x: 1, y: 1 }] },
    { id: 'u2', t: 'airmover', n: 1, log: [{ id: 'l3', action: 'placed', day: 'd1', x: 2, y: 2 }, { id: 'l4', action: 'removed', day: 'd2', x: 2, y: 2 }] },
  ],
});
const time = [
  { worked_on: '2026-11-11', hours: 2, rate_cents: 2500, staff_id: 'secret-staff-id', worker_name: 'Pat Tech' },
  { worked_on: '2026-11-11', hours: 9, rate_cents: 9999, voided_at: '2026-11-12T00:00:00Z' },
];

test('every calendar day is a row, with equipment x its daily cost, logged labor and a running total', () => {
  const b = dailyBurn([{ plan }], { dehu: 5000, airmover: 1500 }, time);
  assert.deepEqual(b.days.map((d) => d.date), ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  assert.deepEqual(b.days.map((d) => d.equipmentCents), [6500, 6500, 6500, 5000]); // the air mover leaves on the 12th, still counted that day
  assert.equal(b.days[1].laborCents, 5000);
  assert.equal(b.days[1].laborHours, 2);
  assert.deepEqual(b.days.map((d) => d.dayCents), [6500, 11500, 6500, 5000]);
  assert.deepEqual(b.days.map((d) => d.runningCents), [6500, 18000, 24500, 29500]);
  assert.equal(b.totals.totalCents, 29500);
  assert.equal(b.avgCents, 7375);
  assert.equal(b.peak.date, '2026-11-11');
});

test('a kind with no daily cost counts as $0 and is called out; a voided entry is ignored', () => {
  const b = dailyBurn([{ plan }], { dehu: 5000 }, time);
  assert.deepEqual(b.missing, ['airmover']);
  assert.equal(b.days[0].equipmentCents, 5000);
  assert.equal(b.totals.laborCents, 5000);
});

test('a job with nothing yet is empty, and the PDF says so', () => {
  const b = dailyBurn([{ plan: emptyPlan() }], {}, []);
  assert.equal(b.empty, true);
  const t = Buffer.from(renderDailyBurn({ info: { customer: 'X' }, burn: b })).toString('latin1');
  assert.ok(t.startsWith('%PDF'));
  assert.ok(t.includes('No equipment has been placed'));
});

test('the PDF shows the days and totals and never a staff name or id', () => {
  const b = dailyBurn([{ plan }], { dehu: 5000, airmover: 1500 }, time);
  const t = Buffer.from(renderDailyBurn({ info: { business: 'Monarch', customer: 'Pat Smith', jobNumber: 7 }, burn: b })).toString('latin1');
  for (const s of ['Daily Burn', '$295.00', '$73.75', 'Nov 11']) assert.ok(t.includes(s), s);
  for (const s of ['Pat Tech', 'secret-staff-id']) assert.ok(!t.includes(s), s);
});
