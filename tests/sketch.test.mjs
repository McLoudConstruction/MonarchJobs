import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyPlan, normalizePlan, newRoom, snap, parseFeet, fmtFeet, roomArea, totalArea, hitRoom, hitHandle,
  hitMarkAt, simplifyStroke, planBounds, fitView, toWorld, toScreen, roomPhotoCounts, distToSegment,
  MAX_ROOMS, MAX_ROOM, MIN_ROOM,
} from '../lib/sketch.js';
import { drawPlan } from '../lib/sketchDraw.js';

test('snapping goes to the nearest half foot without float noise', () => {
  assert.equal(snap(3.26), 3.5);
  assert.equal(snap(3.24), 3);
  assert.equal(snap(-0.3), -0.5);
  assert.equal(snap(0.1 + 0.2), 0.5);
});

test('parseFeet reads feet, decimals and feet-and-inches; rejects nonsense', () => {
  assert.equal(parseFeet('12'), 12);
  assert.equal(parseFeet(' 12.5 '), 12.5);
  assert.equal(parseFeet("12'"), 12);
  assert.equal(parseFeet("12'6"), 12.5);
  assert.equal(parseFeet('12\' 6"'), 12.5);
  assert.equal(parseFeet('12 ft 3 in'), 12.25);
  assert.equal(parseFeet('10ft'), 10);
  for (const bad of ['', 'abc', '12x', "-5", '1,5', null, undefined]) assert.ok(Number.isNaN(parseFeet(bad)), String(bad));
});

test('fmtFeet shows feet and rounded inches', () => {
  assert.equal(fmtFeet(12), "12'");
  assert.equal(fmtFeet(12.5), `12' 6"`);
  assert.equal(fmtFeet(9.99), `10'`);
  assert.equal(fmtFeet(0.5), `0' 6"`);
});

test('areas add up and round to whole square feet', () => {
  const plan = { ...emptyPlan(), rooms: [newRoom('A', 0, 0, 10, 12), newRoom('B', 12, 0, 8.5, 9.5)] };
  assert.equal(roomArea(plan.rooms[0]), 120);
  assert.equal(totalArea(plan), Math.round(120 + 8.5 * 9.5));
  assert.equal(totalArea(emptyPlan()), 0);
});

test('normalizePlan repairs bad data instead of trusting it', () => {
  assert.deepEqual(normalizePlan(null), emptyPlan());
  assert.deepEqual(normalizePlan('x'), emptyPlan());
  const p = normalizePlan({
    rooms: [
      { id: 'a', label: 'L'.repeat(100), x: 'oops', y: 5, w: 100000, h: -3 },
      { id: 'a', label: 'dup id', x: 0, y: 0, w: 5, h: 5 },
      null,
    ],
    marks: [
      { type: 'pen', color: 'javascript:alert(1)', pts: [[1, 2], ['x', 3], [4, 5]] },
      { type: 'text', text: '   ', x: 1, y: 1 },
      { type: 'text', text: 'Door', x: 1.234, y: 2, color: '#ff0000' },
      { type: 'zig' },
    ],
  });
  assert.equal(p.rooms.length, 2);
  assert.equal(p.rooms[0].label.length, 40);
  assert.equal(p.rooms[0].x, 0);
  assert.equal(p.rooms[0].w, MAX_ROOM);
  assert.equal(p.rooms[0].h, MIN_ROOM);
  assert.notEqual(p.rooms[0].id, p.rooms[1].id);
  assert.equal(p.marks.length, 2);
  assert.match(p.marks[0].color, /^#[0-9a-f]{6}$/i);
  assert.deepEqual(p.marks[0].pts, [[1, 2], [4, 5]]);
  assert.equal(p.marks[1].x, 1.23);
});

test('normalizePlan caps how many rooms it keeps', () => {
  const rooms = Array.from({ length: MAX_ROOMS + 20 }, (_, i) => ({ id: `r${i}`, x: i, y: 0, w: 5, h: 5 }));
  assert.equal(normalizePlan({ rooms }).rooms.length, MAX_ROOMS);
});

test('hit testing prefers the room on top and finds the resize handle', () => {
  const a = { id: 'a', label: '', x: 0, y: 0, w: 10, h: 10, notes: '' };
  const b = { id: 'b', label: '', x: 5, y: 5, w: 10, h: 10, notes: '' };
  const plan = { ...emptyPlan(), rooms: [a, b] };
  assert.equal(hitRoom(plan, 7, 7).id, 'b');
  assert.equal(hitRoom(plan, 2, 2).id, 'a');
  assert.equal(hitRoom(plan, 30, 30), null);
  assert.ok(hitHandle(a, 10.2, 9.8, 0.5));
  assert.ok(!hitHandle(a, 5, 5, 0.5));
});

test('pen strokes and text notes can be picked', () => {
  const plan = {
    ...emptyPlan(),
    marks: [
      { id: 'p', type: 'pen', color: '#000000', pts: [[0, 0], [10, 0]] },
      { id: 't', type: 'text', color: '#000000', x: 20, y: 20, text: 'Door' },
    ],
  };
  assert.equal(hitMarkAt(plan, 5, 0.3, 0.5).id, 'p');
  assert.equal(hitMarkAt(plan, 5, 3, 0.5), null);
  assert.equal(hitMarkAt(plan, 21, 19.5, 0.5).id, 't');
  assert.ok(Math.abs(distToSegment(5, 3, 0, 0, 10, 0) - 3) < 1e-9);
  assert.ok(Math.abs(distToSegment(15, 0, 0, 0, 10, 0) - 5) < 1e-9);
});

test('simplifyStroke thins points but keeps the ends', () => {
  const pts = Array.from({ length: 100 }, (_, i) => [i * 0.01, 0]);
  const out = simplifyStroke(pts, 0.5);
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out[out.length - 1], pts[99]);
  assert.ok(out.length < 10);
  assert.equal(simplifyStroke([[0, 0]], 1).length, 1);
});

test('fitView centres the drawing and screen/world conversion round-trips', () => {
  const plan = { ...emptyPlan(), rooms: [newRoom('A', 0, 0, 20, 10)] };
  const view = fitView(planBounds(plan), 400, 300);
  const tl = toScreen(view, 0, 0);
  const br = toScreen(view, 20, 10);
  assert.ok(tl.x >= 0 && br.x <= 400 && tl.y >= 0 && br.y <= 300);
  assert.ok(Math.abs((tl.x + br.x) / 2 - 200) < 1);
  const w = toWorld(view, tl.x + 37, tl.y + 11);
  assert.ok(Math.abs(w.x - 37 / view.scale) < 1e-9 && Math.abs(w.y - 11 / view.scale) < 1e-9);
  assert.equal(planBounds(emptyPlan()), null);
  assert.ok(fitView(null, 400, 300).scale > 0);
});

test('room photo counts ignore archived photos and other sketches', () => {
  const photos = [
    { sketch_id: 's1', room_key: 'a' }, { sketch_id: 's1', room_key: 'a' }, { sketch_id: 's1', room_key: 'b' },
    { sketch_id: 's2', room_key: 'a' }, { sketch_id: 's1', room_key: 'a', archived_at: '2026-11-01' }, { sketch_id: 's1', room_key: null },
  ];
  assert.deepEqual(roomPhotoCounts(photos, 's1'), { a: 2, b: 1 });
});

// A stand-in canvas context that records calls, to be sure drawing never throws.
function fakeCtx() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'calls') return calls;
      if (k === 'measureText') return (s) => ({ width: String(s).length * 7 });
      return (...a) => { calls.push([k, ...a]); };
    },
    set() { return true; },
  });
  return ctx;
}

test('drawPlan renders rooms, labels, marks, selection and a draft without throwing', () => {
  const plan = normalizePlan({
    rooms: [{ id: 'k', label: 'Kitchen', x: 0, y: 0, w: 12, h: 14 }, { id: 'h', label: 'Hall', x: 12, y: 0, w: 3, h: 14 }],
    marks: [{ type: 'pen', color: '#c0392b', pts: [[1, 1], [5, 5]] }, { type: 'text', text: 'Wet', x: 2, y: 3, color: '#2f4858' }],
  });
  const view = fitView(planBounds(plan), 400, 300);
  const ctx = fakeCtx();
  drawPlan(ctx, plan, view, { W: 400, H: 300, selection: { kind: 'room', id: 'k' }, counts: { k: 3 }, draft: { type: 'room', x: 20, y: 0, w: 5, h: 5 } });
  drawPlan(ctx, plan, view, { W: 400, H: 300, selection: { kind: 'mark', id: plan.marks[1].id }, draft: { type: 'pen', color: '#000000', pts: [[0, 0], [1, 1]] } });
  drawPlan(ctx, emptyPlan(), view, { W: 400, H: 300 });
  const text = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(text.includes('Kitchen'));
  assert.ok(text.some((t) => t.includes('168 sq ft')));
  assert.ok(text.includes('3'));
});
