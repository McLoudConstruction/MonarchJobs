import test from 'node:test';
import assert from 'node:assert/strict';
import { walkSteps, closureGap, autoCloseStep, polygonFromSteps, diagCheck, sharedWallMismatches, snapToNeighbour, openingPlace, placeOpeningAt, estimatedRooms } from '../lib/measure.js';
import { normalizePlan, emptyPlan, rectPts } from '../lib/sketch.js';

const room = (id, x, y, w, h, extra = {}) => ({ id, num: 0, type: '', other: '', label: '', notes: '', pts: rectPts(x, y, w, h), ...extra });

test('trace a rectangle closes', () => {
  const steps = [{ len: 12, dir: 'E' }, { len: 10, dir: 'S' }, { len: 12, dir: 'W' }, { len: 10, dir: 'N' }];
  assert.equal(closureGap(steps), 0);
  const r = polygonFromSteps(steps);
  assert.equal(r.pts.length, 4);
});
test('auto close gives the last wall', () => {
  const steps = [{ len: 12, dir: 'E' }, { len: 10, dir: 'S' }, { len: 12, dir: 'W' }];
  assert.deepEqual(autoCloseStep(steps), { len: 10, dir: 'N' });
  assert.equal(autoCloseStep([{ len: 12, dir: 'E' }, { len: 5, dir: 'S' }]), null);
});
test('L shape and closure gap in inches', () => {
  const l = [{ len: 14, dir: 'E' }, { len: 6, dir: 'S' }, { len: 6, dir: 'W' }, { len: 6, dir: 'S' }, { len: 8, dir: 'W' }, { len: 12, dir: 'N' }];
  assert.equal(polygonFromSteps(l).pts.length, 6);
  const off = [{ len: 12, dir: 'E' }, { len: 10, dir: 'S' }, { len: 11.5, dir: 'W' }, { len: 10, dir: 'N' }];
  const r = polygonFromSteps(off, 0.25);
  assert.match(r.error, /6 in off/);
  assert.ok(polygonFromSteps(off, 0.6).pts);
});
test('collinear corners are dropped', () => {
  const steps = [{ len: 6, dir: 'E' }, { len: 6, dir: 'E' }, { len: 10, dir: 'S' }, { len: 12, dir: 'W' }, { len: 10, dir: 'N' }];
  assert.equal(polygonFromSteps(steps).pts.length, 4);
});
test('diagonal check', () => {
  const d = Math.hypot(12, 10);
  assert.ok(diagCheck(12, 10, d, d).ok);
  assert.equal(diagCheck(12, 10, d, d + 0.2).ok, false);
  assert.equal(diagCheck(12, 10, d + 0.3, d + 0.3).ok, false);
});
test('shared wall mismatch', () => {
  const ok = { rooms: [room('a', 0, 0, 12, 10), room('b', 12, 0, 10, 10)] };
  assert.equal(sharedWallMismatches(ok).length, 0);
  const bad = { rooms: [room('a', 0, 0, 12, 10), room('b', 12, 0, 10, 10.5)] };
  assert.equal(sharedWallMismatches(bad).length, 1);
  const partial = { rooms: [room('a', 0, 0, 12, 20), room('b', 12, 0, 10, 8)] };
  assert.equal(sharedWallMismatches(partial).length, 0);
});
test('snap to neighbour', () => {
  const rooms = [room('a', 0, 0, 12, 10), room('b', 13, 1, 8, 8)];
  assert.deepEqual(snapToNeighbour(rooms, 'b'), { dx: -1, dy: 0 });
  assert.equal(snapToNeighbour([room('a', 0, 0, 12, 10), room('b', 30, 0, 8, 8)], 'b'), null);
});
test('opening position by distance from corner', () => {
  const plan = { rooms: [room('a', 0, 0, 12, 10)] };
  const door = { x: 4, y: 0, w: 3 }; // spans 2.5 to 5.5 on the top wall
  const pl = openingPlace(plan, door);
  assert.equal(pl.gapStart, 2.5);
  assert.equal(pl.gapEnd, 6.5);
  assert.deepEqual(placeOpeningAt(plan, door, 1), { x: 2.5, y: 0 });
  assert.equal(placeOpeningAt(plan, door, 11), null);
});
test('meas and diag survive normalizePlan', () => {
  const p = normalizePlan({ ...emptyPlan(), rooms: [room('a', 0, 0, 12, 10, { meas: true, diag: [15.62, 15.65] }), room('b', 20, 0, 5, 5)] });
  assert.equal(p.rooms[0].meas, true);
  assert.deepEqual(p.rooms[0].diag, [15.62, 15.65]);
  assert.equal(p.rooms[1].meas, undefined);
  assert.equal(estimatedRooms(p).length, 1);
});
