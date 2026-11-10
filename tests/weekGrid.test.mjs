import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutDay, timeFromFraction, fractionFromTime, dragStartFromPoint, weekStartMonday, visibleMinutes, techColor } from '../lib/weekGrid.js';

const day = new Date(2026, 10, 10); // Tue Nov 10 2026, local time
const at = (h, m = 0) => new Date(2026, 10, 10, h, m).toISOString();
const v = (id, h, m, dur) => ({ id, starts_at: at(h, m), duration_minutes: dur });

test('a visit is positioned by start time and duration', () => {
  const { items } = layoutDay([v('a', 9, 0, 120)], day);
  assert.equal(items.length, 1);
  const total = visibleMinutes();
  assert.ok(Math.abs(items[0].top - (3 * 60) / total) < 1e-9);       // 9 AM is 3 hours after 6 AM
  assert.ok(Math.abs(items[0].height - 120 / total) < 1e-9);
  assert.equal(items[0].lane, 0);
  assert.equal(items[0].lanes, 1);
});

test('overlapping visits sit side by side; separate ones keep full width', () => {
  const { items } = layoutDay([v('a', 9, 0, 120), v('b', 10, 0, 60), v('c', 14, 0, 60)], day);
  const by = Object.fromEntries(items.map((i) => [i.visit.id, i]));
  assert.equal(by.a.lanes, 2);
  assert.equal(by.b.lanes, 2);
  assert.notEqual(by.a.lane, by.b.lane);
  assert.equal(by.c.lanes, 1);
});

test('back-to-back visits do not share a lane count', () => {
  const { items } = layoutDay([v('a', 9, 0, 60), v('b', 10, 0, 60)], day);
  assert.deepEqual(items.map((i) => i.lanes), [1, 1]);
});

test('visits outside the visible hours are listed separately, partly visible ones are clipped', () => {
  const { items, outside } = layoutDay([v('early', 4, 0, 60), v('late', 21, 0, 60), v('edge', 19, 30, 120)], day);
  assert.deepEqual(outside.map((x) => x.id), ['early', 'late']);
  assert.equal(items.length, 1);
  assert.ok(items[0].top + items[0].height <= 1.0000001);
});

test('visits on other days are ignored', () => {
  const other = { id: 'x', starts_at: new Date(2026, 10, 11, 9).toISOString(), duration_minutes: 60 };
  assert.equal(layoutDay([other], day).items.length, 0);
});

test('clicking snaps to the quarter hour and stays inside the visible hours', () => {
  const total = visibleMinutes();
  const t = timeFromFraction(day, (3 * 60 + 7) / total); // 9:07 -> 9:00
  assert.equal(t.getHours(), 9);
  assert.equal(t.getMinutes(), 0);
  const t2 = timeFromFraction(day, (3 * 60 + 8) / total); // 9:08 -> 9:15
  assert.equal(t2.getMinutes(), 15);
  assert.equal(timeFromFraction(day, -1).getHours(), 6);
  const last = timeFromFraction(day, 5);
  assert.equal(last.getHours(), 19);
  assert.equal(last.getMinutes(), 45);
  assert.ok(Math.abs(fractionFromTime(new Date(2026, 10, 10, 9), day) - 3 / 14) < 1e-9);
});

test('weeks start on Monday', () => {
  const sun = weekStartMonday(new Date(2026, 10, 8));  // Sunday Nov 8
  assert.equal(sun.getDate(), 2);
  assert.equal(sun.getDay(), 1);
  const mon = weekStartMonday(new Date(2026, 10, 9, 15, 30));
  assert.equal(mon.getDate(), 9);
  assert.equal(mon.getHours(), 0);
});

test('tech colors are stable and unassigned is grey', () => {
  const ids = ['a', 'b'];
  assert.equal(techColor(ids, 'a'), techColor(ids, 'a'));
  assert.notEqual(techColor(ids, 'a'), techColor(ids, 'b'));
  assert.equal(techColor(ids, null), '#6b7686');
});

// Dragging the planned appointment
const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 9 + i)); // Mon Nov 9 .. Sun Nov 15
const rects = week.map((_, i) => ({ left: 100 + i * 100, right: 200 + i * 100, top: 50, height: 616 })); // 14 hours * 44px

test('dropping in a column picks that day and snaps the time', () => {
  // halfway down the column = 13:00 (6 AM + 7 hours), in the third column (Wed)
  const d = dragStartFromPoint(week, rects, 350, 50 + 308, 0);
  assert.equal(d.toDateString(), week[2].toDateString());
  assert.equal(d.getHours(), 13);
  assert.equal(d.getMinutes(), 0);
});

test('the grab offset keeps the box under the pointer', () => {
  // grabbed a quarter of the column below the box top; releasing at the half mark puts the start at the quarter mark
  const d = dragStartFromPoint(week, rects, 150, 50 + 308, 0.25);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);
});

test('dragging past the edges sticks to the first or last day and stays inside the visible hours', () => {
  const left = dragStartFromPoint(week, rects, 10, 50 + 308, 0);
  assert.equal(left.toDateString(), week[0].toDateString());
  const right = dragStartFromPoint(week, rects, 5000, 5000, 0);
  assert.equal(right.toDateString(), week[6].toDateString());
  assert.equal(right.getHours(), 19);
  assert.equal(right.getMinutes(), 45);
  const above = dragStartFromPoint(week, rects, 150, -500, 0);
  assert.equal(above.getHours(), 6);
});

test('drag returns null when the columns are not measured', () => {
  assert.equal(dragStartFromPoint(week, [], 150, 100), null);
});
