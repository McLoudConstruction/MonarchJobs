import test from 'node:test';
import assert from 'node:assert/strict';
import { runAnomalyCheck } from '../lib/anomalyServer.js';
import { emptyPlan, newRoom, ensureRoomNums } from '../lib/sketch.js';
import { makeEquipment, pickUpUnit } from '../lib/equipment.js';

// A tiny stand-in for the Supabase admin client: tables are arrays, filters are applied in memory.
function fakeAdmin(tables, { settings, notified = [], rpcLog = [] } = {}) {
  const query = (name) => {
    let rows = tables[name] || [];
    const q = {
      select() { return q; },
      eq(c, v) { rows = rows.filter((r) => r[c] === v); return q; },
      in(c, vs) { rows = rows.filter((r) => vs.includes(r[c])); return q; },
      is(c, v) { rows = rows.filter((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
      limit() { return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
    };
    return q;
  };
  return {
    from(name) {
      if (name === 'settings') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: settings, error: null }) }) }) };
      if (name === 'notifications') return { select: () => ({ in: (c, keys) => Promise.resolve({ data: notified.filter((k) => keys.includes(k)).map((k) => ({ dedupe_key: k })), error: null }) }) };
      return query(name);
    },
    rpc(name, args) { rpcLog.push({ name, args }); return Promise.resolve({ data: name === 'anomaly_notify' ? true : null, error: null }); },
  };
}

const NOW = new Date('2026-11-23T20:00:00Z');
const base = () => ({
  jobs: [{ id: 'j1', job_number: 1042, status: 'in_progress', customer: { display_name: 'Pat Lee' } }, { id: 'j2', job_number: 1043, status: 'booked', customer: { display_name: 'Ng' } }],
  estimates: [{ job_id: 'j1', status: 'approved', minimum_charge: 0, chosen_tier: null, lines: [{ id: 'l1', price_item_id: 'p1', unit: 'sqft', quantity: 100, unit_price: 10, tier: null, optional: false, accepted: false }] }],
  job_clock_sessions: [{ job_id: 'j1', started_at: '2026-11-23T10:00:00Z', ended_at: '2026-11-23T19:00:00Z', voided_at: null }], // 9 h
  job_purchases: [{ job_id: 'j1', amount_cents: 80000, voided_at: null }],
  job_time_entries: [], job_sketches: [], equipment_daily_rates: [],
  price_items: [{ id: 'p1', minutes_per_unit: 3 }], // 100 sq ft x 3 min = 300 min = 5 h allowed
});
const SETTINGS = { anomaly_alerts_enabled: true, anomaly_hours_pct: 120, anomaly_cost_pct: 75, anomaly_equip_days: 5 };

test('nothing runs while the owner has the switch off', async () => {
  const log = [];
  const r = await runAnomalyCheck({ admin: fakeAdmin(base(), { settings: { ...SETTINGS, anomaly_alerts_enabled: false }, rpcLog: log }), now: NOW });
  assert.equal(r.skipped, 'off');
  assert.equal(log.length, 0);
});

test('an open job over its hours and its cost share raises both alerts, once each, through the database', async () => {
  const log = [];
  const r = await runAnomalyCheck({ admin: fakeAdmin(base(), { settings: SETTINGS, rpcLog: log }), now: NOW });
  assert.equal(r.jobs, 2);
  assert.deepEqual(r.items.map((i) => i.kind).sort(), ['cost', 'hours']);
  assert.equal(r.sent, 2);
  const calls = log.filter((c) => c.name === 'anomaly_notify');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.args.p_job === 'j1'));
  assert.ok(log.some((c) => c.name === 'anomaly_resolve_closed'), 'finished jobs get their alerts cleared on every run');
  const hours = r.items.find((i) => i.kind === 'hours');
  assert.equal(hours.title, 'Hours are at 180% of the time allowed');   // 9 h of 5 h
  const cost = r.items.find((i) => i.kind === 'cost');
  assert.equal(cost.title, 'Costs are at 80% of the estimate');         // $800 of $1,000
});

test('an alert that was already sent is not sent again', async () => {
  const log = [];
  const r = await runAnomalyCheck({ admin: fakeAdmin(base(), { settings: SETTINGS, notified: ['anomaly:j1:hours'], rpcLog: log }), now: NOW });
  assert.equal(r.alerts, 2); assert.equal(r.newAlerts, 1);
  assert.deepEqual(log.filter((c) => c.name === 'anomaly_notify').map((c) => c.args.p_kind), ['cost']);
  assert.equal(r.items.find((i) => i.kind === 'hours').alreadySent, true);
});

test('the preview sends nothing, and works even while the switch is off', async () => {
  const log = [];
  const r = await runAnomalyCheck({ admin: fakeAdmin(base(), { settings: { ...SETTINGS, anomaly_alerts_enabled: false }, rpcLog: log }), dryRun: true, now: NOW });
  assert.equal(r.items.length, 2);
  assert.equal(log.length, 0);
});

test('a job under every limit raises nothing, and a running clock counts up to now', async () => {
  const t = base();
  t.job_purchases = [{ job_id: 'j1', amount_cents: 10000, voided_at: null }];
  t.job_clock_sessions = [{ job_id: 'j1', started_at: '2026-11-23T18:00:00Z', ended_at: null, voided_at: null }]; // 2 h so far
  assert.equal((await runAnomalyCheck({ admin: fakeAdmin(t, { settings: SETTINGS }), dryRun: true, now: NOW })).items.length, 0);
  t.job_clock_sessions = [{ job_id: 'j1', started_at: '2026-11-23T12:00:00Z', ended_at: null, voided_at: null }]; // 8 h so far, 160%
  const r = await runAnomalyCheck({ admin: fakeAdmin(t, { settings: SETTINGS }), dryRun: true, now: NOW });
  assert.deepEqual(r.items.map((i) => i.kind), ['hours']);
});

test('equipment still on site past the limit is flagged, and a picked-up machine is not', async () => {
  const by = { id: 'u', name: 'Tech' };
  const dayList = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'].map((date, i) => ({ id: `d${i + 1}`, date }));
  const plan = (units) => ({ ...ensureRoomNums({ ...emptyPlan(), days: dayList, rooms: [newRoom('Kitchen', 0, 0, 12, 10)] }), equipment: units });
  const dh = makeEquipment('dehu', 1, 2, 2, { day: 'd1', by });
  const am = makeEquipment('airmover', 1, 2, 2, { day: 'd1', by });
  const t = base();
  t.estimates = []; t.job_purchases = []; t.job_clock_sessions = [];
  // six calendar days on site (Nov 16 to 21): over the 5-day limit while the dehumidifier is still there
  t.job_sketches = [{ job_id: 'j1', id: 's1', name: 'Main', plan: plan([dh, pickUpUnit(plan([am]), am, { day: 'd2', by })]) }];
  const r = await runAnomalyCheck({ admin: fakeAdmin(t, { settings: SETTINGS }), dryRun: true, now: NOW });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].kind, 'equipment');
  assert.match(r.items[0].title, /6 days/);
  assert.doesNotMatch(r.items[0].body, /AM 1/, 'the air mover was picked up on day 2');
});
