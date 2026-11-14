import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlan, normalizePlan, newRoom, polyArea, polyBox, FLOOR_TYPES, cleanCeil } from '../lib/sketch.js';
import { parseSize, checkShape, shapePts, turnPts, placeBox, roomFromSize, SHAPE_ORDER } from '../lib/roomShapes.js';

test('parseSize reads two sizes written several ways', () => {
  assert.deepEqual(parseSize('12 x 14'), [12, 14]);
  assert.deepEqual(parseSize('12x14'), [12, 14]);
  assert.deepEqual(parseSize("12' by 14'6"), [12, 14.5]);
  assert.deepEqual(parseSize('12 × 10.5'), [12, 10.5]);
  assert.equal(parseSize('12'), null);
  assert.equal(parseSize('12 x'), null);
  assert.equal(parseSize('a x b'), null);
  assert.equal(parseSize(''), null);
});

test('shape areas are the box minus the cut-out', () => {
  assert.equal(polyArea(shapePts('rect', { w: 12, h: 10 })), 120);
  assert.equal(polyArea(shapePts('L', { w: 12, h: 10, cw: 4, cd: 3 })), 120 - 12);
  assert.equal(polyArea(shapePts('U', { w: 12, h: 10, cw: 4, cd: 3 })), 120 - 12);
  assert.equal(polyArea(shapePts('T', { w: 12, h: 10, cw: 4, cd: 3 })), 12 * 3 + 4 * 7);
  for (const s of SHAPE_ORDER) {
    const b = polyBox(shapePts(s, { w: 12, h: 10, cw: 4, cd: 3 }));
    assert.equal(b.w, 12); assert.equal(b.h, 10);
  }
});

test('turning keeps the area and the top-left at 0, 0, and four turns come back', () => {
  const pts = shapePts('L', { w: 12, h: 10, cw: 4, cd: 3 });
  const once = turnPts(pts, 1);
  const b = polyBox(once);
  assert.equal(b.minX, 0); assert.equal(b.minY, 0);
  assert.equal(b.w, 10); assert.equal(b.h, 12);
  assert.equal(polyArea(once), polyArea(pts));
  assert.deepEqual(turnPts(pts, 4), pts);
  assert.deepEqual(turnPts(pts, 0), pts);
  assert.deepEqual(turnPts(turnPts(pts, 1), 3), pts);
});

test('checkShape names what is wrong', () => {
  assert.equal(checkShape('rect', { w: 12, h: 10 }), '');
  assert.match(checkShape('rect', { w: 0, h: 10 }), /between 1 and 500/);
  assert.match(checkShape('rect', { w: NaN, h: 10 }), /between 1 and 500/);
  assert.match(checkShape('L', { w: 12, h: 10, cw: 0, cd: 3 }), /at least/);
  assert.match(checkShape('L', { w: 12, h: 10, cw: 12, cd: 3 }), /less than the width/);
  assert.match(checkShape('L', { w: 12, h: 10, cw: 4, cd: 10 }), /less than the length/);
  assert.match(checkShape('U', { w: 12, h: 10, cw: 11.5, cd: 3 }), /each side/);
  assert.match(checkShape('T', { w: 12, h: 10, cw: 12, cd: 3 }), /narrower/);
  assert.equal(checkShape('L', { w: 12, h: 10, cw: 4, cd: 3 }), '');
  assert.match(checkShape('hexagon', { w: 12, h: 10 }), /Pick a shape/);
});

test('the first room goes at 0, 0 and later rooms go against a side so they share a wall', () => {
  assert.deepEqual(placeBox([], { w: 10, h: 10 }), { x: 0, y: 0 });
  const kitchen = newRoom('Kitchen', 0, 0, 12, 10);
  const bed = newRoom('Bed', 14, 2, 10, 8);
  assert.deepEqual(placeBox([kitchen, bed], { w: 8, h: 8 }), { x: 24, y: 0 }); // right of everything, level with the top
  assert.deepEqual(placeBox([kitchen], { w: 8, h: 8 }, { nextTo: kitchen, side: 'right' }), { x: 12, y: 0 });
  assert.deepEqual(placeBox([kitchen], { w: 8, h: 8 }, { nextTo: kitchen, side: 'below' }), { x: 0, y: 10 });
  assert.deepEqual(placeBox([kitchen], { w: 8, h: 8 }, { nextTo: kitchen, side: 'left' }), { x: -8, y: 0 });
  assert.deepEqual(placeBox([kitchen], { w: 8, h: 8 }, { nextTo: kitchen, side: 'above' }), { x: 0, y: -8 });
});

test('roomFromSize builds a placed room with its type, name and facts, or says why not', () => {
  const kitchen = newRoom('Kitchen', 0, 0, 12, 10);
  const r = roomFromSize([kitchen], { shape: 'rect', w: 10, h: 14.5, type: 'bedroom', label: 'Guest', ceil: 9, floor: 'carpet' }, { nextTo: kitchen, side: 'right' });
  assert.ok(r.room);
  assert.equal(polyArea(r.room.pts), 145);
  assert.deepEqual(polyBox(r.room.pts).minX, 12);
  assert.equal(r.room.type, 'bedroom'); assert.equal(r.room.label, 'Guest'); assert.equal(r.room.ceil, 9); assert.equal(r.room.floor, 'carpet');
  const l = roomFromSize([], { shape: 'L', w: 12, h: 10, cw: 4, cd: 3, turns: 1 });
  assert.equal(polyArea(l.room.pts), 108);
  assert.equal(polyBox(l.room.pts).w, 10);
  assert.ok(roomFromSize([], { shape: 'rect', w: 600, h: 10 }).error);
  assert.ok(roomFromSize([], { shape: 'U', w: 12, h: 10, cw: 4 }).error);
  const bare = roomFromSize([], { shape: 'rect', w: 8, h: 8 });
  assert.equal('ceil' in bare.room, false); assert.equal('floor' in bare.room, false);
});

test('a room made by size survives saving and loading, ceiling and floor included', () => {
  const made = roomFromSize([], { shape: 'rect', w: 12, h: 10, ceil: 9, floor: 'hardwood', type: 'kitchen' }).room;
  const plan = normalizePlan({ ...emptyPlan(), rooms: [made] });
  assert.equal(plan.rooms[0].ceil, 9);
  assert.equal(plan.rooms[0].floor, 'hardwood');
  const junk = normalizePlan({ rooms: [{ ...made, ceil: 'tall', floor: 'lava' }] });
  assert.equal('ceil' in junk.rooms[0], false);
  assert.equal('floor' in junk.rooms[0], false);
  assert.equal(cleanCeil(3), 0); assert.equal(cleanCeil(41), 0); assert.equal(cleanCeil('9.5'), 9.5);
  assert.ok(FLOOR_TYPES.carpet);
});

test('the water class for sizing is kept, and anything odd goes back to automatic', () => {
  assert.equal(normalizePlan({ sizing: { cls: 3 } }).sizing.cls, 3);
  assert.equal(normalizePlan({ sizing: { cls: 9 } }).sizing.cls, 0);
  assert.equal(normalizePlan({}).sizing.cls, 0);
});
