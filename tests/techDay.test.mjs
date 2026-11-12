import test from 'node:test';
import assert from 'node:assert/strict';
import { visitsOnDay, dayHourRange, focusFraction, visitMinutes, sameDay, weekDays } from '../lib/techDay.js';

const day = new Date(2026, 10, 12); // Thu Nov 12 2026, local time
const at = (h, m = 0, d = 12) => new Date(2026, 10, d, h, m).toISOString();
const v = (id, h, m, dur, d = 12) => ({ id, starts_at: at(h, m, d), duration_minutes: dur });

test('visitMinutes uses the stored length, then the end time, then one hour', () => {
  assert.equal(visitMinutes({ duration_minutes: 90 }), 90);
  assert.equal(visitMinutes({ starts_at: at(9), ends_at: at(10, 30) }), 90);
  assert.equal(visitMinutes({ starts_at: at(9), ends_at: at(9) }), 60);
});

test('visitsOnDay keeps only that day, earliest first', () => {
  const list = visitsOnDay([v('b', 14, 0, 60), v('x', 9, 0, 60, 13), v('a', 8, 0, 60), v('y', 9, 0, 60, 11)], day);
  assert.deepEqual(list.map((x) => x.id), ['a', 'b']);
});

test('a visit that runs past midnight shows on both days; one ending exactly at midnight does not', () => {
  const late = v('late', 23, 0, 120);          // 11 PM to 1 AM
  assert.equal(visitsOnDay([late], day).length, 1);
  assert.equal(visitsOnDay([late], new Date(2026, 10, 13)).length, 1);
  const flush = v('flush', 22, 0, 120);        // ends at midnight
  assert.equal(visitsOnDay([flush], new Date(2026, 10, 13)).length, 0);
});

test('dayHourRange is 6 AM to 8 PM unless a visit falls outside it', () => {
  assert.deepEqual(dayHourRange([], day), { startHour: 6, endHour: 20 });
  assert.deepEqual(dayHourRange([v('a', 9, 0, 60)], day), { startHour: 6, endHour: 20 });
  assert.deepEqual(dayHourRange([v('early', 4, 30, 60)], day), { startHour: 4, endHour: 20 });
  assert.deepEqual(dayHourRange([v('late', 19, 0, 150)], day), { startHour: 6, endHour: 22 }); // ends 9:30 PM
  assert.deepEqual(dayHourRange([v('wrap', 23, 0, 120)], day), { startHour: 6, endHour: 24 });
});

test('dayHourRange pulls the start back to midnight for a visit carried over from the night before', () => {
  const carried = v('night', 22, 0, 600, 11); // 10 PM Nov 11 to 8 AM Nov 12
  assert.deepEqual(dayHourRange([carried], day), { startHour: 0, endHour: 20 });
});

test('focusFraction opens today at the current time', () => {
  const range = { startHour: 6, endHour: 20 };
  const f = focusFraction({ visits: [], day, range, now: new Date(2026, 10, 12, 13, 0) });
  assert.ok(Math.abs(f - 7 / 14) < 1e-9); // 1 PM is 7 of 14 hours in
});

test('focusFraction opens another day at its first appointment, or nowhere when empty', () => {
  const range = { startHour: 6, endHour: 20 };
  const now = new Date(2026, 10, 10, 8, 0);
  const f = focusFraction({ visits: [v('a', 9, 0, 60)], day, range, now });
  assert.ok(Math.abs(f - 3 / 14) < 1e-9);
  assert.equal(focusFraction({ visits: [], day, range, now }), null);
});

test('focusFraction stays inside the day when now is outside the shown hours', () => {
  const range = { startHour: 6, endHour: 20 };
  assert.equal(focusFraction({ visits: [], day, range, now: new Date(2026, 10, 12, 2, 0) }), 0);
  assert.equal(focusFraction({ visits: [], day, range, now: new Date(2026, 10, 12, 22, 0) }), 1);
});

test('sameDay and weekDays', () => {
  assert.ok(sameDay(new Date(2026, 10, 12, 1), new Date(2026, 10, 12, 23)));
  assert.ok(!sameDay(new Date(2026, 10, 12), new Date(2026, 10, 13)));
  const w = weekDays(new Date(2026, 10, 9));
  assert.equal(w.length, 7);
  assert.equal(w[6].getDate(), 15);
});
