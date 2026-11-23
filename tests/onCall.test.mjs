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
