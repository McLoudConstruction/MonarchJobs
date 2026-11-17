import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlan, normalizePlan, rectPts, planBounds } from '../lib/sketch.js';
import { addFloor, addStairs, cleanFloors, flattenFloors, floorView, floorIsEmpty, mergeFloor, removeFloor, renameFloor, hasFloors } from '../lib/floors.js';
import { makeObject } from '../lib/objectTypes.js';

const room = (id, x, num) => ({ id, num, type: '', other: '', label: '', notes: '', pts: rectPts(x, 0, 10, 10) });
const base = () => normalizePlan({ ...emptyPlan(), rooms: [room('a', 0, 1), room('b', 20, 2)], sources: [{ id: 's1', x: 2, y: 2, surfaces: ['floor'] }] });

test('a one-floor sketch is untouched by floors', () => {
  const p = base();
  assert.deepEqual(p.floors, []);
  assert.equal(floorView(p, 'x'), p);
  assert.equal(flattenFloors(p), p);
  assert.equal(hasFloors(p), false);
});

test('adding a floor keeps everything on floor 1 and survives a save and reload', () => {
  const { plan, id } = addFloor(base(), '2nd floor');
  assert.deepEqual(plan.floors.map((f) => f.name), ['Floor 1', '2nd floor']);
  const again = normalizePlan(JSON.parse(JSON.stringify(plan)));
  assert.equal(again.floors.length, 2);
  assert.equal(floorView(again, again.floors[0].id).rooms.length, 2);
  assert.equal(floorView(again, id).rooms.length, 0);
});

test('the board edits one floor and the others stay put', () => {
  let { plan, id } = addFloor(base(), 'Upstairs');
  const f1 = plan.floors[0].id;
  const view = floorView(plan, id);
  const merged = mergeFloor(plan, id, { ...view, rooms: [room('c', 0, 1)] }); // a new room whose number clashes with floor 1
  assert.equal(merged.rooms.length, 3);
  assert.equal(merged.floorOf.c, id);
  assert.equal(floorView(merged, f1).rooms.length, 2, 'floor 1 untouched');
  assert.equal(new Set(merged.rooms.map((r) => r.num)).size, 3, 'room numbers stay unique');
  // deleting on floor 1 does not touch floor 2
  const gone = mergeFloor(merged, f1, { ...floorView(merged, f1), rooms: [], sources: [] });
  assert.deepEqual(gone.rooms.map((r) => r.id), ['c']);
  assert.equal(gone.sources.length, 0);
});

test('stairs make a linked pair, one per floor, and a floor with things on it cannot be removed', () => {
  const { plan, id } = addFloor(base(), 'Upstairs');
  const f1 = plan.floors[0].id;
  const s = addStairs(plan, f1, id, 5, 5, makeObject);
  const down = floorView(s, f1).objects;
  const up = floorView(s, id).objects;
  assert.equal(down.length, 1); assert.equal(up.length, 1);
  assert.equal(down[0].label, 'Up to Upstairs'); assert.equal(up[0].label, 'Down to Floor 1');
  assert.notEqual(down[0].id, up[0].id);
  assert.equal(removeFloor(s, id), s, 'not empty, not removed');
  const empty = addFloor(plan, 'Attic').plan;
  assert.equal(floorIsEmpty(empty, empty.floors[2].id), true);
  assert.equal(removeFloor(empty, empty.floors[2].id).floors.length, 2);
  assert.equal(renameFloor(plan, id, '  Loft ').floors[1].name, 'Loft');
  assert.equal(renameFloor(plan, id, '  ').floors[1].name, 'Upstairs');
});

test('stale floor entries are cleaned on load and the floor count is capped', () => {
  const p = normalizePlan({ ...base(), floors: [{ id: 'f1', name: 'A' }, { id: 'f2', name: 'B' }], floorOf: { a: 'f2', ghost: 'f2', b: 'nope' } });
  assert.deepEqual(p.floorOf, { a: 'f2' });
  assert.equal(cleanFloors(Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, name: '' }))).length, 8);
});

test('reports lay the floors side by side with the floor in the room name, nothing overlapping', () => {
  let { plan, id } = addFloor(base(), 'Upstairs');
  plan = mergeFloor(plan, id, { ...floorView(plan, id), rooms: [room('c', 0, 3)] });
  const flat = flattenFloors(plan);
  assert.equal(flat.rooms.length, 3);
  assert.deepEqual(flat.floors, []);
  assert.match(flat.rooms.find((r) => r.id === 'c').label, /^Upstairs - /);
  assert.match(flat.rooms.find((r) => r.id === 'a').label, /^Floor 1 - /);
  const xs = (r) => r.pts.map((p) => p[0]);
  assert.ok(Math.min(...xs(flat.rooms.find((r) => r.id === 'c'))) > Math.max(...xs(flat.rooms.find((r) => r.id === 'b'))), 'floor 2 sits to the right of floor 1');
  assert.ok(planBounds(flat));
});
