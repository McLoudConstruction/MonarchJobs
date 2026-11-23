import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTimeOff, isOffOn, offOn, overlapsExisting, rangeLabel, crewsOn, visitDate } from '../lib/timeOff.js';
import { computeOpenSlots, normalizeBooking, validateBookingSettings } from '../lib/booking.js';

test('time off form', () => {
  assert.match(cleanTimeOff({}).error, /who is off/);
  assert.match(cleanTimeOff({ staff_id: 'a', starts_on: 'x' }).error, /first and last/);
  assert.match(cleanTimeOff({ staff_id: 'a', starts_on: '2026-12-05', ends_on: '2026-12-01' }).error, /before/);
  assert.match(cleanTimeOff({ staff_id: 'a', starts_on: '2026-01-01', ends_on: '2026-12-31' }).error, /at most/);
  assert.deepEqual(cleanTimeOff({ staff_id: 'a', starts_on: '2026-12-01', note: ' hi ' }).value, { staff_id: 'a', starts_on: '2026-12-01', ends_on: '2026-12-01', note: 'hi' });
});

test('dates are inclusive and per person', () => {
  const e = [{ id: 1, staff_id: 'a', starts_on: '2026-12-01', ends_on: '2026-12-03' }, { id: 2, staff_id: 'b', starts_on: '2026-12-03', ends_on: '2026-12-03' }];
  assert.ok(isOffOn(e[0], '2026-12-03'));
  assert.ok(!isOffOn(e[0], '2026-12-04'));
  assert.equal(offOn(e, '2026-12-03').length, 2);
  assert.equal(offOn(e, '2026-12-03', 'b').length, 1);
  assert.ok(overlapsExisting(e, { staff_id: 'a', starts_on: '2026-12-03', ends_on: '2026-12-09' }));
  assert.ok(!overlapsExisting(e, { staff_id: 'a', starts_on: '2026-12-03', ends_on: '2026-12-09' }, 1));
  assert.ok(!overlapsExisting(e, { staff_id: 'c', starts_on: '2026-12-01', ends_on: '2026-12-09' }));
  assert.equal(rangeLabel({ starts_on: '2026-12-01', ends_on: '2026-12-01' }), 'Tue, Dec 1');
  assert.equal(rangeLabel({ starts_on: '2026-12-01', ends_on: '2026-12-03' }), 'Tue, Dec 1 to Thu, Dec 3');
});

test('visit date uses the business time zone', () => {
  assert.equal(visitDate('2026-12-02T03:30:00Z', 'America/Chicago'), '2026-12-01');
});

test('crews on a day are techs who are not off', () => {
  const entries = [{ staff_id: 'a', starts_on: '2026-12-01', ends_on: '2026-12-01' }];
  assert.equal(crewsOn({ techIds: ['a', 'b', 'c'], entries, dateStr: '2026-12-01' }), 2);
  assert.equal(crewsOn({ techIds: ['a', 'b', 'c'], entries, dateStr: '2026-12-02' }), 3);
  assert.equal(crewsOn({ techIds: [], entries, dateStr: '2026-12-02' }), 0);
});

const now = new Date('2026-11-23T14:00:00Z'); // Monday morning, Chicago
const base = { booking_days: [1, 2, 3, 4, 5], booking_notice_hours: 0, booking_window_days: 14, booking_crews: 1, timezone: 'America/Chicago' };
const slotsOn = (r, date) => r.days.find((d) => d.date === date)?.slots.length || 0;

test('capacity mode off keeps the fixed crews number even with capacity data', () => {
  const r = computeOpenSlots({ now, settings: base, capacity: { techIds: ['a', 'b', 'c'], timeOff: [] } });
  assert.equal(slotsOn(r, '2026-11-24'), 3);
  const busy = [{ starts_at: '2026-11-24T14:00:00Z', ends_at: '2026-11-24T16:00:00Z' }];
  assert.equal(slotsOn(computeOpenSlots({ now, settings: base, busy, capacity: { techIds: ['a', 'b', 'c'], timeOff: [] } }), '2026-11-24'), 2); // fixed 1 crew: the 8-10 visit closes only the 8-10 slot
});

test('capacity mode: more techs, more simultaneous visits; time off closes days', () => {
  const settings = { ...base, booking_capacity_enabled: true };
  const capacity = { techIds: ['a', 'b'], timeOff: [{ staff_id: 'a', starts_on: '2026-11-25', ends_on: '2026-11-25' }, { staff_id: 'b', starts_on: '2026-11-25', ends_on: '2026-11-25' }] };
  const busy = [{ starts_at: '2026-11-24T14:00:00Z', ends_at: '2026-11-24T16:00:00Z' }]; // 8-10 Tuesday
  const r = computeOpenSlots({ now, settings, busy, capacity });
  assert.equal(slotsOn(r, '2026-11-24'), 3); // two techs: one visit leaves the other free for every slot
  assert.equal(slotsOn(r, '2026-11-25'), 0); // both off
  const one = computeOpenSlots({ now, settings, busy, capacity: { techIds: ['a'], timeOff: [] } });
  assert.ok(slotsOn(one, '2026-11-24') < 3); // one tech: the busy visit closes the slots near it
  assert.equal(normalizeBooking(settings).capacity, true);
  assert.equal(normalizeBooking({}).capacity, false);
});

test('capacity setting is saved by the settings form', () => {
  const f = { booking_days: [1], booking_day_start: '08:00', booking_day_end: '17:00', booking_slot_minutes: 120, booking_gap_minutes: 60, booking_crews: 1, booking_notice_hours: 24, booking_window_days: 30, booking_capacity_enabled: true };
  assert.equal(validateBookingSettings(f).value.booking_capacity_enabled, true);
  assert.equal(validateBookingSettings({ ...f, booking_capacity_enabled: undefined }).value.booking_capacity_enabled, false);
});
