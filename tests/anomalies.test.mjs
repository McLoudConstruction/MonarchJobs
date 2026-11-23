import test from 'node:test';
import assert from 'node:assert/strict';
import { readAnomalySettings, cleanAnomalyForm, checkJob, anomalyKey, ANOMALY_DEFAULTS } from '../lib/anomalies.js';

const S = { enabled: true, hoursPct: 120, costPct: 75, equipDays: 5 };
const job = { number: 1042, customer: 'Pat Lee' };

test('settings fall back to the defaults when missing or out of range', () => {
  assert.deepEqual(readAnomalySettings(null), ANOMALY_DEFAULTS);
  assert.deepEqual(readAnomalySettings({ anomaly_alerts_enabled: true, anomaly_hours_pct: 150, anomaly_cost_pct: 60, anomaly_equip_days: 3 }), { enabled: true, hoursPct: 150, costPct: 60, equipDays: 3 });
  assert.equal(readAnomalySettings({ anomaly_hours_pct: 50 }).hoursPct, 120);
  assert.equal(readAnomalySettings({ anomaly_cost_pct: 'x' }).costPct, 75);
  assert.equal(readAnomalySettings({ anomaly_equip_days: 0 }).equipDays, 5);
  assert.equal(readAnomalySettings({}).enabled, false);
});

test('the form accepts whole numbers in range and says what is wrong otherwise', () => {
  assert.deepEqual(cleanAnomalyForm({ enabled: true, hoursPct: '130', costPct: '80', equipDays: '4' }), { value: { anomaly_hours_pct: 130, anomaly_cost_pct: 80, anomaly_equip_days: 4, anomaly_alerts_enabled: true } });
  assert.match(cleanAnomalyForm({ enabled: true, hoursPct: '99', costPct: '80', equipDays: '4' }).error, /100 to 500/);
  assert.match(cleanAnomalyForm({ enabled: true, hoursPct: '120', costPct: '5', equipDays: '4' }).error, /10 to 200/);
  assert.match(cleanAnomalyForm({ enabled: true, hoursPct: '120', costPct: '80', equipDays: '2.5' }).error, /1 to 60/);
  assert.ok(cleanAnomalyForm({ enabled: false, hoursPct: '', costPct: '80', equipDays: '4' }).error);
});

test('hours alert when the clock reaches the set share of the time allowed', () => {
  const facts = (clocked) => ({ clockedMinutes: clocked, allotted: { minutes: 240, any: true }, costCents: 0, estimateCents: 0, equipment: [] });
  assert.equal(checkJob(job, facts(287), S).length, 0);          // 119.6%
  const a = checkJob(job, facts(288), S);                        // exactly 120%
  assert.equal(a.length, 1); assert.equal(a[0].kind, 'hours');
  assert.equal(a[0].title, 'Hours are at 120% of the time allowed');
  assert.match(a[0].body, /Job #1042 · Pat Lee · 4 h 48 min on the clock, 4 h 00 min allowed/);
});

test('no hours alert when no line has a time rate, when nothing is clocked, or when the allowance is zero', () => {
  const base = { costCents: 0, estimateCents: 0, equipment: [] };
  assert.equal(checkJob(job, { ...base, clockedMinutes: 600, allotted: { minutes: 0, any: false } }, S).length, 0);
  assert.equal(checkJob(job, { ...base, clockedMinutes: 0, allotted: { minutes: 240, any: true } }, S).length, 0);
  assert.equal(checkJob(job, { ...base, clockedMinutes: 600, allotted: { minutes: 0, any: true } }, S).length, 0);
});

test('cost alerts when costs reach the set share of the approved estimate, and not without an estimate', () => {
  const base = { clockedMinutes: 0, allotted: { any: false }, equipment: [] };
  assert.equal(checkJob(job, { ...base, costCents: 74999, estimateCents: 100000 }, S).length, 0);
  const c = checkJob(job, { ...base, costCents: 75000, estimateCents: 100000 }, S);
  assert.equal(c[0].kind, 'cost');
  assert.equal(c[0].title, 'Costs are at 75% of the estimate');
  assert.match(c[0].body, /\$750\.00 of \$1,000\.00/);
  assert.equal(checkJob(job, { ...base, costCents: 90000, estimateCents: 0 }, S).length, 0);
  assert.equal(checkJob(job, { ...base, costCents: 0, estimateCents: 100000 }, S).length, 0);
});

test('equipment alerts for machines on site as many days as the limit, naming them', () => {
  const base = { clockedMinutes: 0, allotted: { any: false }, costCents: 0, estimateCents: 0 };
  assert.equal(checkJob(job, { ...base, equipment: [{ code: 'AM 1', days: 4 }] }, S).length, 0);
  const e = checkJob(job, { ...base, equipment: [{ code: 'AM 1', days: 5 }, { code: 'DH 1', days: 6 }, { code: 'AM 2', days: 2 }] }, S);
  assert.equal(e.length, 1);
  assert.equal(e[0].title, 'Equipment has been on site 6 days');
  assert.match(e[0].body, /AM 1, DH 1$/);
  const many = checkJob(job, { ...base, equipment: Array.from({ length: 9 }, (_, i) => ({ code: `AM ${i + 1}`, days: 7 })) }, S);
  assert.match(many[0].body, /and 3 more$/);
});

test('one job can raise all three, each with its own key so each is sent once', () => {
  const all = checkJob(job, { clockedMinutes: 600, allotted: { minutes: 240, any: true }, costCents: 90000, estimateCents: 100000, equipment: [{ code: 'DH 1', days: 8 }] }, S);
  assert.deepEqual(all.map((a) => a.kind), ['hours', 'cost', 'equipment']);
  assert.equal(anomalyKey('abc', 'cost'), 'anomaly:abc:cost');
});

test('alert wording is plain and calm', () => {
  const all = checkJob(job, { clockedMinutes: 900, allotted: { minutes: 240, any: true }, costCents: 200000, estimateCents: 100000, equipment: [{ code: 'DH 1', days: 30 }] }, S);
  for (const a of all) assert.doesNotMatch(a.title + a.body, /!|urgent|warning|danger|over budget|losing/i);
});
