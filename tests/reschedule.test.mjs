import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReschedule, rescheduleStatus, rescheduleNote, buildRescheduleMessages, busyExcludingVisit, RESCHEDULE_ERRORS } from '../lib/reschedule.js';
import { computeOpenSlots, findSlot } from '../lib/booking.js';

const now = new Date('2026-11-23T16:00:00Z');
const on = { reschedule_enabled: true, reschedule_notice_hours: 24, reschedule_max: 2 };
const visit = (over = {}) => ({ id: 'v1', status: 'scheduled', starts_at: '2026-11-26T14:00:00Z', reschedule_count: 0, ...over });

test('settings stay inside their limits and default off', () => {
  assert.equal(normalizeReschedule({}).enabled, false);
  assert.deepEqual(normalizeReschedule({ reschedule_enabled: true, reschedule_notice_hours: 9999, reschedule_max: 0 }), { enabled: true, noticeHours: 336, max: 1 });
});

test('who may move a visit', () => {
  assert.deepEqual(rescheduleStatus({ visit: visit(), jobType: 'floor_cleaning', settings: on, now }), { allowed: true });
  assert.equal(rescheduleStatus({ visit: visit(), jobType: 'floor_cleaning', settings: { ...on, reschedule_enabled: false }, now }).reason, 'off');
  assert.equal(rescheduleStatus({ visit: visit(), jobType: 'water_restoration', settings: on, now }).reason, 'type');
  assert.equal(rescheduleStatus({ visit: visit({ status: 'on_the_way' }), jobType: 'floor_cleaning', settings: on, now }).reason, 'not_scheduled');
  assert.equal(rescheduleStatus({ visit: visit({ starts_at: '2026-11-24T08:00:00Z' }), jobType: 'floor_cleaning', settings: on, now }).reason, 'too_late');
  assert.equal(rescheduleStatus({ visit: visit({ reschedule_count: 2 }), jobType: 'floor_cleaning', settings: on, now }).reason, 'limit');
  assert.equal(rescheduleStatus({ visit: visit({ reschedule_count: 1 }), jobType: 'floor_cleaning', settings: on, now }).allowed, true);
});

test('what the customer is told when they cannot move it', () => {
  assert.match(rescheduleNote({ allowed: false, reason: 'too_late' }, '(417) 555-0100'), /coming up soon.*\(417\) 555-0100/);
  assert.match(rescheduleNote({ allowed: false, reason: 'limit' }, ''), /most times we allow/);
  assert.equal(rescheduleNote({ allowed: true }), '');
  assert.equal(rescheduleNote({ allowed: false, reason: 'off' }), '');
  for (const code of ['SLOT_TAKEN', 'TOO_LATE', 'LIMIT_REACHED', 'NOT_SCHEDULED', 'NOT_ALLOWED_TYPE', 'RESCHEDULE_OFF', 'SAME_TIME', 'NOT_FOUND']) assert.ok(RESCHEDULE_ERRORS[code]);
});

test('the new time is chosen from slots that free up the visit\'s own time and its crew', () => {
  const settings = { timezone: 'America/Chicago', booking_days: [1, 2, 3, 4, 5], booking_day_start: '08:00', booking_day_end: '17:00', booking_slot_minutes: 120, booking_gap_minutes: 60, booking_crews: 1, booking_notice_hours: 24, booking_window_days: 14 };
  const mine = { id: 'v1', crew_id: 'v1', starts_at: '2026-11-26T14:00:00Z', ends_at: '2026-11-26T16:00:00Z' }; // Thu 8-10 Central
  const crewmate = { id: 'v2', crew_id: 'v1', starts_at: '2026-11-26T14:00:00Z', ends_at: '2026-11-26T16:00:00Z' };
  const other = { id: 'v3', crew_id: null, starts_at: '2026-11-26T17:00:00Z', ends_at: '2026-11-26T19:00:00Z' }; // Thu 11-1
  const busy = [mine, crewmate, other];
  const free = busyExcludingVisit(busy, mine);
  assert.deepEqual(free.map((r) => r.id), ['v3']);
  const withMine = computeOpenSlots({ now, settings, busy });
  const without = computeOpenSlots({ now, settings, busy: free });
  assert.equal(findSlot(withMine.days, '2026-11-26T14:00:00Z'), null);
  assert.ok(findSlot(without.days, '2026-11-26T14:00:00Z'), 'its own slot opens up when it moves');
  assert.equal(findSlot(without.days, '2026-11-26T17:00:00Z'), null, 'another job still blocks its slot');
});

test('confirmation: new time and street only, no STOP line, link to change again', () => {
  const m = buildRescheduleMessages({ business: 'Monarch', firstName: 'Sam', startIso: '2026-11-30T14:00:00Z', endIso: '2026-11-30T16:00:00Z', tz: 'America/Chicago', street: '12 Oak St', link: 'https://x.test/v/t', phone: '(417) 555-0100' });
  assert.match(m.sms, /^Hi Sam, your visit with Monarch is now Mon, Nov 30, 8:00 AM to 10:00 AM at 12 Oak St\./);
  assert.match(m.sms, /https:\/\/x\.test\/v\/t/);
  assert.ok(!/STOP/.test(m.sms));
  assert.match(m.html, /View your visit/); assert.match(m.subject, /Mon, Nov 30/);
});
