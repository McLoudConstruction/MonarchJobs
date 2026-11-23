import test from 'node:test';
import assert from 'node:assert/strict';
import { bestOrder, totalDrive, planRoute, REASON_TEXT } from '../lib/routeOrder.js';

// stops on a line at positions; drive seconds = 60 * distance
const line = (pos) => pos.map((a) => pos.map((b) => Math.abs(a - b) * 60));

test('best order visits the line in sequence with the first stop fixed', () => {
  assert.deepEqual(bestOrder(line([0, 30, 10, 20])), [0, 2, 3, 1]);
  assert.deepEqual(bestOrder(line([5])), [0]);
  assert.deepEqual(bestOrder([]), []);
  assert.equal(totalDrive(line([0, 10, 20]), [0, 1, 2]), 1200);
});

test('unknown drive times or too many stops give no answer', () => {
  const m = line([0, 1, 2]); m[0][2] = null;
  assert.equal(bestOrder(m), null);
  assert.equal(bestOrder(line(Array.from({ length: 11 }, (_, i) => i))), null);
});

test('the answer is never worse than the current order (random matrices)', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let t = 0; t < 40; t += 1) {
    const n = 3 + Math.floor(rnd() * 5);
    const m = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Math.round(rnd() * 3000) + 60)));
    const order = bestOrder(m);
    assert.equal(order[0], 0);
    assert.equal(new Set(order).size, n);
    assert.ok(totalDrive(m, order) <= totalDrive(m, [...Array(n).keys()]));
  }
});

const day = (starts, dur = 120) => starts.map((h, i) => ({ id: `v${i}`, starts_at: `2026-12-01T${String(h).padStart(2, '0')}:00:00Z`, duration_minutes: dur }));

test('a worse order gets a suggestion that swaps jobs between the same time slots', () => {
  // positions: stop0 at 0, stop1 at 40, stop2 at 10, stop3 at 20 (drive 1 min per unit)
  const p = planRoute({ stops: day([8, 11, 14, 17]), matrix: line([0, 40, 10, 20]) });
  assert.equal(p.ok, true);
  assert.deepEqual(p.order, [0, 2, 3, 1]);
  assert.equal(p.savedSeconds, (40 + 30 + 10) * 60 - (10 + 10 + 20) * 60);
  const byId = Object.fromEntries(p.moves.map((m) => [m.id, m]));
  assert.equal(byId.v2.newStart, '2026-12-01T11:00:00.000Z'); // the third job takes the second slot
  assert.equal(byId.v1.newStart, '2026-12-01T17:00:00.000Z'); // the second job goes last
  assert.equal(p.moves.length, 3);
});

test('no suggestion for two stops, an already short order, or jobs that would not fit', () => {
  assert.equal(planRoute({ stops: day([8, 11]), matrix: line([0, 5]) }).reason, 'few');
  assert.equal(planRoute({ stops: day([8, 11, 14]), matrix: line([0, 10, 20]) }).reason, 'already');
  assert.equal(planRoute({ stops: day([8, 11, 14]), matrix: line([0, 5, 6]), roundTo: 900 }).reason, 'already'); // saves under 5 minutes
  const tight = planRoute({ stops: [
    { id: 'a', starts_at: '2026-12-01T08:00:00Z', duration_minutes: 120 },
    { id: 'b', starts_at: '2026-12-01T10:30:00Z', duration_minutes: 30 },
    { id: 'c', starts_at: '2026-12-01T12:00:00Z', duration_minutes: 120 },
  ], matrix: line([0, 40, 10]) });
  assert.equal(tight.ok, false);
  assert.equal(tight.reason, 'nofit'); // job c is long and cannot end before the last slot's neighbor needs it
  assert.ok(REASON_TEXT.nofit);
});

test('unknown drive time is reported', () => {
  const m = line([0, 1, 2]); m[1][2] = null;
  assert.equal(planRoute({ stops: day([8, 11, 14]), matrix: m }).reason, 'unknown');
});
