import test from 'node:test';
import assert from 'node:assert/strict';
import { monthGridDays, addMonths, groupVisitsByDay, dayRows, dayKey, MAX_ROWS_PER_DAY } from '../lib/monthGrid.js';

test('month grid is whole Monday-to-Sunday weeks covering the month', () => {
  const days = monthGridDays(new Date(2026, 10, 17)); // November 2026 starts on a Sunday
  assert.equal(days.length % 7, 0);
  assert.equal(days[0].getDay(), 1); // Monday
  assert.equal(days[days.length - 1].getDay(), 0); // Sunday
  assert.equal(dayKey(days[0]), '2026-10-26');
  assert.equal(dayKey(days[days.length - 1]), '2026-12-06');
  assert.equal(days.length, 42);
});

test('a month that starts on Monday and ends on Sunday is exactly four weeks', () => {
  const days = monthGridDays(new Date(2027, 1, 10)); // February 2027
  assert.equal(days.length, 28);
  assert.equal(dayKey(days[0]), '2027-02-01');
});

test('addMonths moves by whole months from the first of the month', () => {
  assert.equal(dayKey(addMonths(new Date(2026, 10, 30), 1)), '2026-12-01');
  assert.equal(dayKey(addMonths(new Date(2026, 0, 31), -1)), '2025-12-01');
});

test('visits group by local day in time order', () => {
  const map = groupVisitsByDay([
    { id: 'b', starts_at: new Date(2026, 10, 10, 13, 0).toISOString() },
    { id: 'a', starts_at: new Date(2026, 10, 10, 8, 0).toISOString() },
    { id: 'c', starts_at: new Date(2026, 10, 11, 9, 0).toISOString() },
  ]);
  assert.deepEqual(map.get('2026-11-10').map((v) => v.id), ['a', 'b']);
  assert.deepEqual(map.get('2026-11-11').map((v) => v.id), ['c']);
});

test('a day never draws more than the maximum rows', () => {
  const list = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
  assert.deepEqual(dayRows(list(3)), { shown: list(3), more: 0 });
  assert.equal(dayRows(list(4)).shown.length, 4);
  assert.equal(dayRows(list(4)).more, 0);
  const five = dayRows(list(5));
  assert.equal(five.shown.length, MAX_ROWS_PER_DAY - 1);
  assert.equal(five.more, 2);
  assert.equal(five.shown.length + 1, MAX_ROWS_PER_DAY); // the "+N more" row fills the last slot
  const ten = dayRows(list(10));
  assert.equal(ten.shown.length + ten.more, 10);
});
