import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clockStepFor, startsAtOnTheWay, sessionMinutes, sessionHours, totalMinutes, clockText, durationText, validateEdit, allottedMinutes, efficiency, efficiencyRollup,
} from '../lib/jobClock.js';
import { USER_COLORS, USER_COLOR_KEYS, colorFor, techColorOf, autoColorKey, isColorKey } from '../lib/userColors.js';

const T = (s) => new Date(`2026-11-17T${s}:00Z`).toISOString();

test('the clock starts at On the way for restoration and at Start job for carpet', () => {
  for (const svc of ['extraction', 'mitigation', 'remediation']) {
    assert.ok(startsAtOnTheWay(svc));
    assert.equal(clockStepFor({ service: svc, action: 'on_the_way', open: false }), 'open');
    assert.equal(clockStepFor({ service: svc, action: 'started', open: true }), 'arrive');
  }
  assert.ok(!startsAtOnTheWay('carpet'));
  assert.equal(clockStepFor({ service: 'carpet', action: 'on_the_way', open: false }), null);
  assert.equal(clockStepFor({ service: 'carpet', action: 'started', open: false }), 'open');
  assert.equal(clockStepFor({ service: '', action: 'started', open: false }), 'open'); // a job with no service
});

test('finish stops a running clock, and does nothing when it is already stopped (a lunch clock-out)', () => {
  assert.equal(clockStepFor({ service: 'carpet', action: 'finished', open: true }), 'close');
  assert.equal(clockStepFor({ service: 'carpet', action: 'finished', open: false }), null);
  assert.equal(clockStepFor({ service: 'mitigation', action: 'on_the_way', open: true }), null); // ETA update: do not start a second clock
});

test('minutes and hours of a session', () => {
  const s = { started_at: T('14:00'), ended_at: T('15:30') };
  assert.equal(sessionMinutes(s), 90);
  assert.equal(sessionHours(s), 1.5);
  assert.equal(sessionHours({ started_at: T('14:00'), ended_at: new Date(new Date(T('14:00')).getTime() + 10000).toISOString() }), 0); // ten seconds
  assert.equal(sessionHours({ started_at: T('14:00'), ended_at: null }), 0);
  assert.equal(sessionHours({ started_at: T('00:00'), ended_at: new Date(new Date(T('00:00')).getTime() + 30 * 3600000).toISOString() }), 24); // capped
  const running = { started_at: T('14:00'), ended_at: null };
  assert.equal(sessionMinutes(running, new Date(T('14:45'))), 45);
});

test('a travel segment counts as job time, and two sessions on a job add up', () => {
  const travel = { started_at: T('13:15'), arrived_at: T('13:45'), ended_at: T('15:00') }; // 30 min travel inside 105 min
  const lunch = { started_at: T('15:30'), ended_at: T('16:30') };
  assert.equal(totalMinutes([travel, lunch]), 165);
  assert.equal(totalMinutes([travel, { ...lunch, voided_at: T('17:00') }]), 105); // removed entries do not count
});

test('clock and duration text', () => {
  assert.equal(clockText(125), '2:05');
  assert.equal(clockText(7), '0:07');
  assert.equal(durationText(45), '45 min');
  assert.equal(durationText(125), '2 h 05 min');
});

test('a time change needs a finished entry, sensible times and a reason', () => {
  const session = { started_at: T('14:00'), ended_at: T('15:00') };
  const now = new Date(T('20:00'));
  const ok = validateEdit({ session, started_at: T('13:30'), ended_at: T('15:00'), reason: 'Forgot to clock in at the van' }, now);
  assert.ok(ok.value);
  assert.equal(ok.value.started_at, T('13:30'));
  assert.match(validateEdit({ session: { ...session, ended_at: null }, started_at: T('13:30'), ended_at: T('15:00'), reason: 'x y z' }, now).error, /still running/);
  assert.match(validateEdit({ session, started_at: T('15:00'), ended_at: T('14:00'), reason: 'swap' }, now).error, /after the start/);
  assert.match(validateEdit({ session, started_at: T('13:30'), ended_at: T('15:00'), reason: ' ' }, now).error, /why/);
  assert.match(validateEdit({ session, started_at: T('14:00'), ended_at: T('15:00'), reason: 'same' }, now).error, /same times/);
  assert.match(validateEdit({ session, started_at: T('14:00'), ended_at: T('23:00'), reason: 'future' }, now).error, /future/);
  assert.match(validateEdit({ session: { ...session, voided_at: T('16:00') }, started_at: T('13:30'), ended_at: T('15:00'), reason: 'gone' }, now).error, /removed/);
  const far = validateEdit({ session, started_at: new Date(new Date(T('14:00')).getTime() - 3 * 86400000).toISOString(), ended_at: T('15:00'), reason: 'way back' }, now);
  assert.ok(far.error);
});

const line = (o) => ({ id: o.id || Math.random().toString(36), unit_price: 1, tier: null, optional: false, accepted: false, ...o });

test('allotted time comes from the price list time rates', () => {
  const items = { sqft: 0.05, room: 20, flat: 45 };
  const est = { status: 'sent', chosen_tier: null, lines: [
    line({ price_item_id: 'sqft', unit: 'sqft', quantity: 1200 }),   // 60 min
    line({ price_item_id: 'room', unit: 'room', quantity: 3 }),      // 60 min
    line({ price_item_id: 'flat', unit: 'flat', quantity: 1 }),      // 45 min
    line({ unit: 'hour', quantity: 1.5 }),                           // 90 min, no rate needed
    line({ unit: 'each', quantity: 2, is_custom: true }),            // custom line: no rate
    line({ price_item_id: 'room', unit: 'room', quantity: 1, unit_price: -10 }), // discount: no time
  ] };
  const a = allottedMinutes(est, Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v])));
  assert.equal(a.minutes, 60 + 60 + 45 + 90);
  assert.equal(a.unrated, 1);
  assert.ok(a.any);
});

test('allotted time counts only what the customer chose: their tier and the add-ons they ticked', () => {
  const items = { base: 30, good: 10, best: 25, odor: 15 };
  const lines = [
    line({ id: 'b', price_item_id: 'base', unit: 'room', quantity: 1 }),
    line({ id: 'g', price_item_id: 'good', unit: 'room', quantity: 1, tier: 'good' }),
    line({ id: 'x', price_item_id: 'best', unit: 'room', quantity: 1, tier: 'best' }),
    line({ id: 'o', price_item_id: 'odor', unit: 'room', quantity: 1, optional: true, accepted: true }),
    line({ id: 'n', price_item_id: 'odor', unit: 'room', quantity: 1, optional: true, accepted: false }),
  ];
  assert.equal(allottedMinutes({ status: 'approved', chosen_tier: 'best', lines }, items).minutes, 30 + 25 + 15);
  assert.equal(allottedMinutes({ status: 'approved', chosen_tier: 'good', lines }, items).minutes, 30 + 10 + 15);
  assert.equal(allottedMinutes({ status: 'sent', chosen_tier: null, lines }, items).minutes, 30); // not approved yet: only the included line
  assert.deepEqual(allottedMinutes(null, items), { minutes: 0, unrated: 0, rated: 0, any: false });
});

test('efficiency: dollars per clocked hour and use of the allotted time', () => {
  const e = efficiency({ revenueCents: 30000, clockedMinutes: 180, allottedMinutes: 150 });
  assert.equal(e.perHourCents, 10000);
  assert.equal(e.usedPct, 120);
  assert.equal(e.diffMinutes, 30);
  assert.ok(e.over);
  const none = efficiency({ revenueCents: null, clockedMinutes: 0, allottedMinutes: 0 });
  assert.deepEqual([none.perHourCents, none.usedPct, none.over], [null, null, false]);
  assert.equal(efficiency({ revenueCents: 5000, clockedMinutes: 60, allottedMinutes: 90 }).over, false);
});

test('the owner roll-up shares a job’s price by each person’s minutes and skips jobs with no clock or no price', () => {
  const r = efficiencyRollup([
    { jobId: 'a', revenueCents: 30000, allottedMinutes: 150, byStaff: { sam: 120, lee: 60 } }, // 180 min total, $166.67/h
    { jobId: 'b', revenueCents: 12000, allottedMinutes: 0, byStaff: { sam: 60 } },            // $120/h, no rates set
    { jobId: 'c', revenueCents: null, allottedMinutes: 60, byStaff: { sam: 60 } },             // no price: skipped
    { jobId: 'd', revenueCents: 9000, allottedMinutes: 60, byStaff: {} },                      // no clock: skipped
  ]);
  assert.equal(r.jobs, 2);
  assert.equal(r.skipped, 2);
  assert.equal(r.clockedMinutes, 240);
  assert.equal(r.revenueCents, 42000);
  assert.equal(r.perHourCents, 10500);
  assert.equal(r.allottedMinutes, 150);
  assert.equal(r.usedPct, 120); // only job a has a rate: 180 of 150
  const sam = r.byStaff.find((s) => s.staffId === 'sam');
  assert.equal(sam.minutes, 180);
  assert.equal(sam.revenueCents, Math.round(30000 * (120 / 180) + 12000));
  assert.equal(r.byStaff.reduce((n, s) => n + s.revenueCents, 0), 42000);
  assert.deepEqual(efficiencyRollup([]).perHourCents, null);
});

test('the palette has 12 distinct colors', () => {
  assert.equal(USER_COLORS.length, 12);
  assert.equal(new Set(USER_COLOR_KEYS).size, 12);
  assert.equal(new Set(USER_COLORS.map((c) => c.hex)).size, 12);
  for (const c of USER_COLORS) assert.match(c.hex, /^#[0-9a-f]{6}$/i);
  assert.ok(isColorKey('teal') && !isColorKey('pink') && !isColorKey(''));
});

test('a person shows in the color they picked; a blank gets a stable unused one', () => {
  const staff = [
    { id: 'a', color: 'blue', created_at: '2026-01-01' },
    { id: 'b', color: '', created_at: '2026-01-02' },
    { id: 'c', color: '', created_at: '2026-01-03' },
  ];
  assert.equal(colorFor(staff[0], staff).key, 'blue');
  const b = colorFor(staff[1], staff).key; const c = colorFor(staff[2], staff).key;
  assert.notEqual(b, 'blue');
  assert.notEqual(b, c);
  assert.equal(colorFor(staff[1], [...staff].reverse()).key, b); // does not depend on list order
  assert.equal(autoColorKey(staff.slice(0, 1)), 'orange'); // first color nobody has
  assert.equal(techColorOf(staff, 'a'), USER_COLORS.find((x) => x.key === 'blue').hex);
  assert.equal(techColorOf(staff, null), '#6b7686');
});
