import test from 'node:test';
import assert from 'node:assert/strict';
import { onCallAt, upcomingWeeks, weekStartFor, validateOnCall, pickPerson } from '../lib/onCall.js';

const A = 'ann', B = 'bob', C = 'cy';
const cfg = { tz: 'America/Chicago', oncall_order: [A, B, C], oncall_start: '2026-11-23', oncall_handoff_hour: 8, timeOff: [], overrides: [] };
const at = (iso) => new Date(iso).getTime(); // chicago is UTC-6 in winter
const who = (iso, c = cfg) => onCallAt(at(iso), c)?.staffId;

test('weeks rotate in order and wrap', () => {
  assert.equal(who('2026-11-23T16:00:00Z'), A);
  assert.equal(who('2026-11-30T16:00:00Z'), B);
  assert.equal(who('2026-12-07T16:00:00Z'), C);
  assert.equal(who('2026-12-14T16:00:00Z'), A);
});

test('Monday before the handoff hour is still last week', () => {
  assert.equal(who('2026-11-23T13:00:00Z'), C); // 7:00 am Chicago
  assert.equal(who('2026-11-23T14:00:00Z'), A); // 8:00 am Chicago
  assert.equal(who('2026-11-30T05:00:00Z'), A); // Sunday 11 pm
});

test('until is the next handoff', () => {
  assert.equal(onCallAt(at('2026-11-23T16:00:00Z'), cfg).until, at('2026-11-30T14:00:00Z'));
});

test('time off skips to the next person in the list', () => {
  const c = { ...cfg, timeOff: [{ staff_id: A, starts_on: '2026-11-23', ends_on: '2026-11-27' }] };
  assert.equal(who('2026-11-24T16:00:00Z', c), B);
  assert.equal(who('2026-11-28T16:00:00Z', c), A); // back by Saturday
});

test('an inactive person is skipped', () => {
  assert.equal(who('2026-11-24T16:00:00Z', { ...cfg, isActive: (id) => id !== A }), B);
});

test('a swap wins over the rotation and ends on time', () => {
  const c = { ...cfg, overrides: [{ staff_id: C, starts_at: '2026-11-25T18:00:00-06:00', ends_at: '2026-11-26T08:00:00-06:00' }] };
  const r = onCallAt(at('2026-11-26T02:00:00Z'), c);
  assert.equal(r.staffId, C); assert.equal(r.swapped, true);
  assert.equal(who('2026-11-26T15:00:00Z', c), A);
});

test('nobody set up gives null', () => {
  assert.equal(onCallAt(Date.now(), { ...cfg, oncall_order: [] }), null);
  assert.equal(onCallAt(Date.now(), { ...cfg, oncall_start: '' }), null);
});

test('upcoming weeks list the rotation', () => {
  const w = upcomingWeeks(at('2026-11-23T16:00:00Z'), 4, cfg);
  assert.deepEqual(w.map((x) => x.staffId), [A, B, C, A]);
  assert.equal(w[0].weekStart, '2026-11-23');
});

test('week start before the start date still works', () => {
  assert.equal(weekStartFor(at('2026-11-18T16:00:00Z'), 'America/Chicago', 8), '2026-11-16');
  assert.equal(who('2026-11-18T16:00:00Z'), C);
});

test('pickPerson returns null when everyone is out', () => {
  assert.equal(pickPerson([A], 0, '2026-11-24', { timeOff: [{ staff_id: A, starts_on: '2026-11-24', ends_on: '2026-11-24' }] }), null);
});

test('validation', () => {
  const ok = { oncall_enabled: true, oncall_order: [A, B], oncall_start: '2026-11-23', oncall_handoff_hour: 8, oncall_wait_minutes: 15 };
  assert.ok(validateOnCall(ok).value);
  assert.match(validateOnCall({ ...ok, oncall_start: '2026-11-24' }).error, /Monday/);
  assert.match(validateOnCall({ ...ok, oncall_order: [A, A] }).error, /once/);
  assert.match(validateOnCall({ ...ok, oncall_order: [] }).error, /Pick the Monday|Add at least/);
  assert.match(validateOnCall({ ...ok, oncall_wait_minutes: 2 }).error, /5 and 120/);
  assert.match(validateOnCall({ ...ok, oncall_handoff_hour: 30 }).error, /0 and 23/);
});

import { offDaysInWeek, rotationConflicts, bestOrder, dayInfo } from '../lib/onCall.js';

test('off days in a week count only that week', () => {
  const to = [{ staff_id: A, starts_on: '2026-11-26', ends_on: '2026-12-02' }];
  assert.equal(offDaysInWeek(A, '2026-11-23', to), 4); // Thu to Sun
  assert.equal(offDaysInWeek(A, '2026-11-30', to), 3); // Mon to Wed
  assert.equal(offDaysInWeek(A, '2026-12-07', to), 0);
  assert.equal(offDaysInWeek(B, '2026-11-23', to), 0);
});

test('rotation conflicts count weeks where the on-call person is off', () => {
  const to = [{ staff_id: A, starts_on: '2026-11-23', ends_on: '2026-11-24' }];
  assert.deepEqual(rotationConflicts([A, B, C], '2026-11-23', to, 6), { weeksHit: 1, daysHit: 2 });
  assert.deepEqual(rotationConflicts([B, A, C], '2026-11-23', to, 6), { weeksHit: 0, daysHit: 0 });
  assert.deepEqual(rotationConflicts([], '2026-11-23', to, 6), { weeksHit: 0, daysHit: 0 });
});

test('best order moves people away from their own time off, and keeps the order when nothing differs', () => {
  const to = [{ staff_id: A, starts_on: '2026-11-23', ends_on: '2026-11-24' }, { staff_id: B, starts_on: '2026-11-30', ends_on: '2026-11-30' }];
  const r = bestOrder([A, B, C], '2026-11-23', to, 6);
  assert.equal(r.weeksHit, 0);
  assert.equal(r.order.length, 3);
  assert.deepEqual(bestOrder([A, B, C], '2026-11-23', [], 6).order, [A, B, C]);
  assert.deepEqual(bestOrder([A], '2026-11-23', to, 6).order, [A]);
});

test('best order handles a long list by swapping', () => {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  const to = [{ staff_id: 'p1', starts_on: '2026-11-23', ends_on: '2026-11-25' }];
  const r = bestOrder(ids, '2026-11-23', to, 16);
  assert.equal(r.weeksHit, 0);
  assert.deepEqual([...r.order].sort(), [...ids].sort());
});

test('calendar day info: planned person, who covers, and who is off', () => {
  const c = { ...cfg, timeOff: [{ staff_id: A, starts_on: '2026-11-24', ends_on: '2026-11-25' }] };
  const mon = dayInfo('2026-11-23', c);
  assert.equal(mon.staffId, A); assert.equal(mon.covering, false); assert.deepEqual(mon.off, []);
  const tue = dayInfo('2026-11-24', c);
  assert.equal(tue.plannedId, A); assert.equal(tue.staffId, B); assert.equal(tue.covering, true); assert.equal(tue.plannedOff, true); assert.deepEqual(tue.off, [A]);
  const swapped = dayInfo('2026-11-25', { ...c, overrides: [{ staff_id: C, starts_at: '2026-11-25T00:00:00-06:00', ends_at: '2026-11-26T00:00:00-06:00' }] });
  assert.equal(swapped.staffId, C); assert.equal(swapped.swapped, true); assert.equal(swapped.covering, false);
});
