// Adding a room by typing its size: a rectangle, or an L, T or U shape, turned any way, placed against a room that
// is already there. Pure functions (no DOM), so they can be tested.
//
// Every shape is made inside a box of `w` x `h` feet with its top-left corner at 0, 0, then turned and moved.
//   rect  a plain rectangle
//   L     a rectangle with a corner cut out (cut-out `cw` wide and `cd` deep, in the top-right corner before turning)
//   T     a bar `cd` deep across the top, with a stem `cw` wide hanging from the middle of it
//   U     a rectangle with a notch cut into the middle of its top edge (`cw` wide, `cd` deep)

import { MAX_ROOM, MIN_ROOM, makeId, parseFeet, polyBox, rectPts, roomBox } from './sketch.js';

const round2 = (n) => Math.round(n * 100) / 100;
const MIN_CUT = 0.5;

export const SHAPES = {
  rect: { label: 'Rectangle', cut: null },
  L: { label: 'L shape', cut: { w: 'Cut-out width', d: 'Cut-out depth' } },
  T: { label: 'T shape', cut: { w: 'Stem width', d: 'Top bar depth' } },
  U: { label: 'U shape', cut: { w: 'Notch width', d: 'Notch depth' } },
};
export const SHAPE_ORDER = Object.keys(SHAPES);
export const SIDES = { right: 'Right of', below: 'Below', left: 'Left of', above: 'Above' };

// Reads "12 x 14", "12x14", "12' by 14'6", "12 × 14" into [12, 14]. Null when it is not two sizes.
export function parseSize(input) {
  const parts = String(input ?? '').toLowerCase().replace(/[×*]/g, 'x').split(/\s*(?:x|by)\s*/);
  if (parts.length !== 2) return null;
  const a = parseFeet(parts[0]);
  const b = parseFeet(parts[1]);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

// What is wrong with the sizes, in words for the person typing, or '' when the shape can be made.
export function checkShape(shape, { w, h, cw, cd }) {
  const span = (v) => Number.isFinite(v) && v >= MIN_ROOM && v <= MAX_ROOM;
  if (!SHAPES[shape]) return 'Pick a shape.';
  if (!span(w) || !span(h)) return `Width and length must each be between ${MIN_ROOM} and ${MAX_ROOM} feet, like 12 or 12'6".`;
  if (shape === 'rect') return '';
  if (!(cw >= MIN_CUT) || !(cd >= MIN_CUT)) return `${SHAPES[shape].cut.w} and ${SHAPES[shape].cut.d.toLowerCase()} must be at least ${MIN_CUT} feet.`;
  if (shape === 'L' || shape === 'U') {
    if (cw > w - MIN_CUT) return `${SHAPES[shape].cut.w} has to be less than the width, ${w} feet.`;
    if (cd > h - MIN_CUT) return `${SHAPES[shape].cut.d} has to be less than the length, ${h} feet.`;
  }
  if (shape === 'U' && cw > w - 2 * MIN_CUT) return `Leave at least ${MIN_CUT} foot of wall on each side of the notch.`;
  if (shape === 'T') {
    if (cw > w - 2 * MIN_CUT) return `The stem has to be narrower than the width, ${w} feet, with room on each side.`;
    if (cd > h - MIN_CUT) return `${SHAPES.T.cut.d} has to be less than the length, ${h} feet.`;
  }
  return '';
}

// The corner points of a shape with its top-left at 0, 0. Walls run clockwise from the top-left.
export function shapePts(shape, { w, h, cw = 0, cd = 0 }) {
  if (shape === 'L') return [[0, 0], [w - cw, 0], [w - cw, cd], [w, cd], [w, h], [0, h]];
  if (shape === 'U') { const a = (w - cw) / 2; return [[0, 0], [a, 0], [a, cd], [a + cw, cd], [a + cw, 0], [w, 0], [w, h], [0, h]]; }
  if (shape === 'T') { const a = (w - cw) / 2; return [[0, 0], [w, 0], [w, cd], [a + cw, cd], [a + cw, h], [a, h], [a, cd], [0, cd]]; }
  return rectPts(0, 0, w, h);
}

// Turns points a quarter turn clockwise, `turns` times, and puts the top-left of the box back at 0, 0.
export function turnPts(pts, turns = 1) {
  let out = pts.map((p) => [p[0], p[1]]);
  const n = ((Math.round(turns) % 4) + 4) % 4;
  for (let i = 0; i < n; i += 1) {
    const b = polyBox(out);
    out = out.map(([x, y]) => [b.maxY - y, x - b.minX]); // (x, y) -> (h - y, x)
  }
  const b = polyBox(out);
  return out.map(([x, y]) => [round2(x - b.minX), round2(y - b.minY)]);
}

// Where the new room's top-left corner goes: against a side of `nextTo` (its top or left edges lined up), or to the right
// of everything already drawn, or at 0, 0 when the plan is empty. Rooms touch exactly, so they share a wall.
export function placeBox(rooms, box, { nextTo = null, side = 'right' } = {}) {
  const list = rooms || [];
  if (!list.length) return { x: 0, y: 0 };
  if (nextTo) {
    const b = roomBox(nextTo);
    if (side === 'below') return { x: b.minX, y: b.maxY };
    if (side === 'left') return { x: round2(b.minX - box.w), y: b.minY };
    if (side === 'above') return { x: b.minX, y: round2(b.minY - box.h) };
    return { x: b.maxX, y: b.minY };
  }
  let maxX = -Infinity; let minY = Infinity;
  for (const r of list) { const b = roomBox(r); maxX = Math.max(maxX, b.maxX); minY = Math.min(minY, b.minY); }
  return { x: maxX, y: minY };
}

// Makes the room: shape, turned, placed. Returns { room } or { error }.
//   spec: { shape, w, h, cw, cd, turns, type, other, label, ceil, floor }; opts: { nextTo, side }
export function roomFromSize(rooms, spec, opts = {}) {
  const shape = spec.shape || 'rect';
  const dims = { w: Number(spec.w), h: Number(spec.h), cw: Number(spec.cw) || 0, cd: Number(spec.cd) || 0 };
  const error = checkShape(shape, dims);
  if (error) return { error };
  const pts = turnPts(shapePts(shape, dims), shape === 'rect' ? 0 : spec.turns || 0);
  const box = polyBox(pts);
  const at = placeBox(rooms, box, opts);
  const room = {
    id: makeId(), num: 0, type: spec.type || '', other: spec.type === 'other' ? String(spec.other || '').slice(0, 30) : '',
    label: String(spec.label || '').slice(0, 40), notes: '',
    pts: pts.map(([x, y]) => [round2(x + at.x), round2(y + at.y)]),
  };
  if (Number(spec.ceil) > 0) room.ceil = Number(spec.ceil);
  if (spec.floor) room.floor = spec.floor;
  return { room };
}

// A room turned a quarter turn clockwise `turns` times, keeping the top-left of its box where it was.
export function turnRoomPts(pts, turns = 1) {
  const b = polyBox(pts);
  return turnPts(pts, turns).map(([x, y]) => [round2(x + b.minX), round2(y + b.minY)]);
}
