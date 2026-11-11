import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlan, rectPts, planBounds } from '../lib/sketch.js';
import { OBJECT_TYPES, cleanObjects, makeObject, objectCounts } from '../lib/objectTypes.js';
import { placeObject, hitObject, toLocal, nearestWall } from '../lib/sketchObjects.js';
import { drawPlan } from '../lib/sketchDraw.js';

const room = { id: 'r', label: '', notes: '', pts: rectPts(0, 0, 12, 10) };
const plan = normalizePlan({ rooms: [room] });
const uid = (x) => x || 'id';

test('every object type is complete', () => {
  for (const [id, t] of Object.entries(OBJECT_TYPES)) {
    assert.ok(t.label && t.group && ['wall', 'wallpoint', 'box', 'point'].includes(t.mode), id);
    assert.ok(t.w > 0 && t.d > 0 && t.on.length, id);
  }
});

test('cleanObjects drops unknown types and limits numbers', () => {
  const out = cleanObjects([
    { t: 'door', x: 3, y: 0, w: 3 },
    { t: 'spaceship', x: 1, y: 1 },
    { t: 'island', x: 'bad', y: 1 },
    { t: 'base', x: 1, y: 2, w: 9999, d: -4, r: -90, label: 'x'.repeat(99), h: 100, f: 1 },
  ], uid);
  assert.equal(out.length, 2);
  assert.equal(out[1].w, 100);
  assert.equal(out[1].d, 0.1);
  assert.equal(out[1].r, 270);
  assert.equal(out[1].label.length, 40);
  assert.equal(out[1].h, 30);
  assert.equal(out[1].f, true);
});

test('objects survive normalizePlan and old plans get an empty list', () => {
  assert.deepEqual(normalizePlan({ rooms: [room] }).objects, []);
  const p = normalizePlan({ rooms: [room], objects: [makeObject('window', 6, 0)] });
  assert.equal(p.objects.length, 1);
  assert.equal(p.objects[0].t, 'window');
});

test('a door snaps onto the nearest wall facing into the room', () => {
  const top = placeObject(plan, 'door', 5.1, 0.6);
  assert.equal(top.y, 0);
  assert.equal(top.r, 0); // local +y points down into the room
  const bottom = placeObject(plan, 'door', 5, 9.7);
  assert.equal(bottom.y, 10);
  assert.equal(bottom.r, 180);
  const left = placeObject(plan, 'window', 0.5, 5);
  assert.equal(left.x, 0);
  assert.ok(left.r === 270 || left.r === 90);
  // its inward direction really is into the room
  const a = (left.r * Math.PI) / 180;
  const inward = [-Math.sin(a), Math.cos(a)];
  assert.ok(inward[0] > 0.9, `inward ${inward}`);
});

test('a wall item stays inside the wall ends', () => {
  const p = placeObject(plan, 'door', 0.2, 0.1); // 3 ft door near the corner
  assert.ok(p.x >= 1.5);
});

test('a cabinet sits flush against a nearby wall, and holds still when far from one', () => {
  const near = placeObject(plan, 'base', 4, 1.2, { });
  assert.equal(near.y, 1); // back on the wall: centre is half the 2 ft depth in
  const far = placeObject(plan, 'island', 6.13, 5.1);
  assert.deepEqual([far.x, far.y, far.r], [6.25, 5, 0]);
  const free = placeObject(plan, 'base', 4, 1.2, { free: true });
  assert.equal(free.y, 1.25);
});

test('Alt places a door freely', () => {
  const p = placeObject(plan, 'door', 5, 0.3, { free: true });
  assert.equal(p.y, 0.25);
});

test('hitObject respects rotation and the surface view', () => {
  const island = makeObject('island', 6, 5, { r: 90 }); // 6 ft long, now running up and down
  const p = { ...plan, objects: [island] };
  assert.equal(hitObject(p, 6, 7.5, 0.2)?.id, island.id);
  assert.equal(hitObject(p, 8, 5, 0.2), null);
  assert.equal(hitObject(p, 6, 5, 0.2, 'ceiling'), null); // an island is not on the ceiling view
  assert.deepEqual(toLocal({ x: 6, y: 5, r: 90 }, 6, 7).map((v) => Math.round(v * 100) / 100), [2, 0]);
});

test('counts and bounds include objects', () => {
  const p = { ...plan, objects: [makeObject('outlet', 0, 3), makeObject('outlet', 0, 6), makeObject('door', 5, 0)] };
  assert.deepEqual(objectCounts(p).map((c) => [c.label, c.count]), [['Outlet', 2], ['Door', 1]]);
  const far = { ...plan, objects: [makeObject('base', 30, 5)] };
  assert.ok(planBounds(far).maxX > 30);
});

test('every object type draws without throwing, selected or not, in every surface view', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : (typeof k === 'string' && !(k in t) ? (...a) => { calls.push(k); } : t[k])), set: (t, k, v) => { t[k] = v; return true; } });
  const objects = Object.keys(OBJECT_TYPES).map((t, i) => makeObject(t, 2 + (i % 6) * 3, 2 + Math.floor(i / 6) * 3, { f: i % 2 === 0, m: i % 3 === 0 }));
  const p = { ...plan, objects };
  for (const surface of ['all', 'floor', 'wall', 'ceiling']) {
    drawPlan(ctx, p, { scale: 20, ox: 10, oy: 10 }, { W: 400, H: 300, surface });
  }
  drawPlan(ctx, p, { scale: 20, ox: 10, oy: 10 }, { W: 400, H: 300, selection: { kind: 'object', id: objects[3].id }, ghost: objects[0] });
  assert.ok(calls.length > 100);
});

test('nearestWall reports the wall under a point', () => {
  const w = nearestWall(plan, 5, 0.3, 1);
  assert.ok(w && Math.abs(w.s - 5) < 1e-6 && w.ny > 0);
  assert.equal(nearestWall(plan, 5, 5, 1), null);
});

import { parseInches, inchesText, isInches } from '../lib/objectTypes.js';
test('doors and windows are measured in inches', () => {
  assert.ok(isInches('door') && isInches('window') && isInches('garage') && !isInches('island') && !isInches('outlet'));
  assert.equal(parseInches('36'), 3);
  assert.equal(parseInches('32"'), 32 / 12);
  assert.equal(parseInches('30 in'), 2.5);
  assert.equal(parseInches("6'8\""), 6 + 8 / 12);
  assert.equal(parseInches("3'"), 3);
  assert.ok(Number.isNaN(parseInches('abc')));
  assert.equal(inchesText(3), '36"');
  assert.equal(inchesText(32 / 12), '32"');
  assert.equal(inchesText(2.6875), '32.25"');
});

test('door types: every door type is a door family member and draws', () => {
  const doors = Object.entries(OBJECT_TYPES).filter(([, t]) => t.family === 'door').map(([id]) => id);
  for (const want of ['door', 'doubledoor', 'french', 'slider', 'bypass', 'pocket', 'bifold', 'barn', 'dutch', 'garage']) assert.ok(doors.includes(want), want);
  const o = makeObject('bifold', 4, 0);
  assert.equal(o.oh, 80 / 12);
  assert.ok(Math.abs(cleanObjects([{ ...o, w: 32 / 12 }], (x) => x)[0].w - 32 / 12) < 1e-4); // 32" survives storage
});
