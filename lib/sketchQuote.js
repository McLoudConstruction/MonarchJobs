// From the sketch to the quote: what each room measures once the things that stay in it are taken out, with its floor type,
// so a price per square foot can be applied to the right number. Pure and tested.
import { OBJECT_TYPES } from './objectTypes.js';
import { FLOOR_TYPES, pointInPoly, roomArea, roomTitle } from './sketch.js';

// Floor-standing things that are not cleaned, refinished or replaced under: they come out of the square footage.
// (Stairs, loose items and "other" stay in: they are floor the work usually covers.)
export const FIXED_TYPES = new Set(['base', 'tall', 'island', 'counter', 'vanity', 'builtin', 'sink', 'toilet', 'tub', 'shower', 'fridge', 'range', 'dishwasher', 'washer', 'dryer', 'waterheater', 'furnace', 'fireplace', 'column']);

const round1 = (n) => Math.round(n * 10) / 10;

// Area the fixed objects standing in a room take, in sq ft: [{ label, area }]
export function fixedInRoom(plan, room) {
  const out = [];
  for (const o of plan.objects || []) {
    const t = OBJECT_TYPES[o.t];
    if (!t || t.mode !== 'box' || !FIXED_TYPES.has(o.t) || !t.on.includes('floor')) continue;
    if (!pointInPoly(room.pts, o.x, o.y)) continue;
    const a = Number(o.w) * Number(o.d);
    if (a > 0) out.push({ label: o.label || t.label, area: round1(a) });
  }
  return out;
}

// One row per room: { id, name, floor, floorKey, area, fixed, net, ceil, fixedItems }
export function roomQuoteRows(plan) {
  return (plan.rooms || []).map((r) => {
    const area = roomArea(r);
    const items = fixedInRoom(plan, r);
    const fixed = Math.min(items.reduce((s, x) => s + x.area, 0), area * 0.9); // never takes the whole room
    return { id: r.id, name: roomTitle(r), floorKey: r.floor || '', floor: r.floor ? FLOOR_TYPES[r.floor] : '', area: round1(area), fixed: round1(fixed), net: round1(area - fixed), ceil: r.ceil || 0, fixedItems: items };
  });
}

// The quantity to bill for a price item of this unit in a room.
export function quoteQuantity(unit, row, useNet = true) {
  if (unit === 'sqft') return useNet ? row.net : row.area;
  return 1;
}
