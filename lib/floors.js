// Floors: one sketch can hold several storeys (basement, 1st floor, 2nd floor...). Pure, so the rules can be tested.
//
//   plan.floors   [{ id, name }] bottom to top. Empty = a one-floor sketch (how every older sketch is).
//   plan.floorOf  { elementId: floorId } for the things drawn on a floor. An element with no entry is on the FIRST floor,
//                 so a sketch that gains floors keeps everything it already had on floor 1.
//
// The drawing board only ever sees ONE floor at a time (floorView) and hands back that floor (mergeFloor), so none of the
// drawing, hit-testing, snapping or measuring code needs to know floors exist. Days, standards and the equipment list
// belong to the whole sketch. Stairs are two linked objects, one on each floor, in the same spot.
import { roomTitle } from './sketch.js';

export const MAX_FLOORS = 8;
export const FLOOR_LISTS = ['rooms', 'areas', 'sources', 'objects', 'moisture', 'equipment', 'comments', 'marks'];
const makeId = () => `f${Math.random().toString(36).slice(2, 8)}`;

export function cleanFloors(raw) {
  const out = [];
  const seen = new Set();
  for (const f of (Array.isArray(raw) ? raw : []).slice(0, MAX_FLOORS)) {
    if (!f || typeof f !== 'object') continue;
    let id = typeof f.id === 'string' && f.id && f.id.length <= 20 ? f.id : makeId();
    while (seen.has(id)) id = makeId();
    seen.add(id);
    out.push({ id, name: String(f.name ?? '').trim().slice(0, 30) || `Floor ${out.length + 1}` });
  }
  return out;
}

// floorOf: keep only entries for elements that exist and floors that exist.
export function cleanFloorOf(raw, floors, ids) {
  const ok = new Set(floors.map((f) => f.id));
  const out = {};
  if (!raw || typeof raw !== 'object' || !floors.length) return out;
  for (const [k, v] of Object.entries(raw)) if (ids.has(k) && ok.has(v)) out[k] = v;
  return out;
}

export const hasFloors = (plan) => (plan?.floors || []).length > 1;
export const firstFloorId = (plan) => plan?.floors?.[0]?.id || null;
export const floorOfElement = (plan, id) => plan?.floorOf?.[id] || firstFloorId(plan);

// A sketch always has a current floor once it has any: the one asked for, else the first.
export const currentFloor = (plan, wanted) => ((plan.floors || []).some((f) => f.id === wanted) ? wanted : firstFloorId(plan));

// The plan as the drawing board should see it: only this floor's things.
export function floorView(plan, floorId) {
  if (!plan.floors?.length) return plan;
  const on = (e) => floorOfElement(plan, e.id) === floorId;
  const out = { ...plan };
  for (const k of FLOOR_LISTS) out[k] = (plan[k] || []).filter(on);
  const roomIds = new Set(out.rooms.map((r) => r.id));
  out.chambers = (plan.chambers || []).filter((c) => (c.rooms || []).every((id) => roomIds.has(id)));
  return out;
}

// Put the board's version of one floor back into the whole sketch. New things are filed on that floor; things the board no
// longer has are gone; other floors are untouched.
export function mergeFloor(full, floorId, view) {
  if (!full.floors?.length) return view;
  const out = { ...view, floors: full.floors };
  const floorOf = {};
  const roomsHere = new Set();
  for (const k of FLOOR_LISTS) {
    const other = (full[k] || []).filter((e) => floorOfElement(full, e.id) !== floorId);
    for (const e of other) floorOf[e.id] = floorOfElement(full, e.id);
    for (const e of view[k] || []) floorOf[e.id] = floorId;
    out[k] = [...other, ...(view[k] || [])];
  }
  for (const r of view.rooms || []) roomsHere.add(r.id);
  const otherRoomIds = new Set(full.rooms.filter((r) => floorOfElement(full, r.id) !== floorId).map((r) => r.id));
  const otherChambers = (full.chambers || []).filter((c) => (c.rooms || []).some((id) => otherRoomIds.has(id)));
  out.chambers = [...otherChambers, ...(view.chambers || [])];
  out.floorOf = floorOf;
  // room numbers stay unique across the whole sketch: a new room that took a number another floor holds gets a fresh one
  const taken = new Set(out.rooms.filter((r) => !roomsHere.has(r.id)).map((r) => r.num));
  let top = out.rooms.reduce((m, r) => Math.max(m, r.num || 0), 0);
  out.rooms = out.rooms.map((r) => {
    if (!roomsHere.has(r.id)) return r;
    if (r.num > 0 && !taken.has(r.num)) { taken.add(r.num); return r; }
    top += 1; taken.add(top);
    return { ...r, num: top };
  });
  return out;
}

// Add a floor on top. A sketch with none becomes floors "Floor 1" (everything already drawn) and the new one.
export function addFloor(plan, name = '') {
  const floors = plan.floors?.length ? [...plan.floors] : [{ id: makeId(), name: 'Floor 1' }];
  if (floors.length >= MAX_FLOORS) return { plan, id: null };
  const id = makeId();
  floors.push({ id, name: String(name).trim().slice(0, 30) || `Floor ${floors.length + 1}` });
  return { plan: { ...plan, floors }, id };
}

export function renameFloor(plan, id, name) {
  const n = String(name ?? '').trim().slice(0, 30);
  if (!n) return plan;
  return { ...plan, floors: (plan.floors || []).map((f) => (f.id === id ? { ...f, name: n } : f)) };
}

export const floorIsEmpty = (plan, id) => FLOOR_LISTS.every((k) => (plan[k] || []).every((e) => floorOfElement(plan, e.id) !== id));

// Remove a floor that has nothing on it. Returns the plan unchanged when it is not empty (nothing is ever deleted with it).
export function removeFloor(plan, id) {
  if (!floorIsEmpty(plan, id)) return plan;
  const floors = (plan.floors || []).filter((f) => f.id !== id);
  return floors.length > 1 ? { ...plan, floors } : { ...plan, floors: [], floorOf: {} };
}

// Stairs between two floors: a Stairs object on each, in the same spot, each saying where it goes.
export function addStairs(plan, fromId, toId, x, y, makeObject) {
  const a = (plan.floors || []).find((f) => f.id === fromId);
  const b = (plan.floors || []).find((f) => f.id === toId);
  if (!a || !b || a.id === b.id) return plan;
  const up = plan.floors.indexOf(b) > plan.floors.indexOf(a);
  const lower = makeObject('stairs', x, y, { label: `${up ? 'Up' : 'Down'} to ${b.name}`.slice(0, 40) });
  const upper = makeObject('stairs', x, y, { label: `${up ? 'Down' : 'Up'} to ${a.name}`.slice(0, 40) });
  upper.id = `${upper.id}b`.slice(0, 40);
  return {
    ...plan,
    objects: [...plan.objects, lower, upper],
    floorOf: { ...(plan.floorOf || {}), [lower.id]: fromId, [upper.id]: toId },
  };
}

const shiftPts = (pts, dx) => pts.map(([x, y]) => [x + dx, y]);
function shiftElement(k, e, dx) {
  if (e.pts) return { ...e, pts: shiftPts(e.pts, dx) };
  if (k === 'equipment') return { ...e, log: (e.log || []).map((l) => ({ ...l, x: l.x + dx })) };
  return { ...e, x: e.x + dx };
}

// For reports, which draw ONE picture: lay the floors side by side, left to right, bottom floor first, each room named
// with its floor. A one-floor sketch comes back unchanged.
export function flattenFloors(plan) {
  if (!hasFloors(plan)) return plan;
  const out = { ...plan, floors: [], floorOf: {} };
  for (const k of FLOOR_LISTS) out[k] = [];
  let cursor = 0;
  for (const f of plan.floors) {
    const view = floorView(plan, f.id);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const r of view.rooms) for (const [x] of r.pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    if (!Number.isFinite(minX)) { minX = 0; maxX = 0; }
    const dx = cursor - minX;
    for (const k of FLOOR_LISTS) {
      for (const e of view[k]) {
        let moved = shiftElement(k, e, dx);
        if (k === 'rooms') moved = { ...moved, label: `${f.name} - ${roomTitle(e)}` };
        out[k].push(moved);
      }
    }
    cursor += maxX - minX + 12;
  }
  return out;
}
