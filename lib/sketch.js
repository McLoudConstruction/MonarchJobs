// Sketch data model and geometry. Pure functions only (no DOM), so they can be tested.
//
// A sketch is one JSON document, measured in feet:
//   { v: 1, rooms: [{ id, label, x, y, w, h, notes }], marks: [{ id, type: 'pen', color, pts: [[x, y], ...] }
//                                                           | { id, type: 'text', x, y, text, color }] }
// x, y is the room's top-left corner; w is the width (left to right) and h the length (top to bottom).
// Later layers (moisture points, equipment) can be added beside rooms and marks without a migration.

export const SKETCH_VERSION = 1;
export const SNAP = 0.5; // feet
export const MIN_ROOM = 1;
export const MAX_ROOM = 500;
export const MAX_ROOMS = 80;
export const MAX_MARKS = 400;
export const MAX_POINTS = 2000;

export const ROOM_PRESETS = [
  'Kitchen', 'Living room', 'Dining room', 'Bedroom', 'Bathroom', 'Hallway',
  'Laundry', 'Basement', 'Garage', 'Office', 'Closet', 'Entry',
];
export const MARK_COLORS = ['#2f4858', '#c0392b', '#2d7ff9', '#3a6b45', '#b9770e'];

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function makeId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

export const emptyPlan = () => ({ v: SKETCH_VERSION, rooms: [], marks: [] });

export const snap = (v, step = SNAP) => round2(Math.round(v / step) * step);

// Reads whatever came out of the database and returns a plan the editor can trust.
export function normalizePlan(raw) {
  const plan = emptyPlan();
  if (!raw || typeof raw !== 'object') return plan;
  const seen = new Set();
  const uid = (id) => {
    let s = typeof id === 'string' && id && id.length <= 40 ? id : makeId();
    while (seen.has(s)) s = makeId();
    seen.add(s);
    return s;
  };
  for (const r of (Array.isArray(raw.rooms) ? raw.rooms : []).slice(0, MAX_ROOMS)) {
    if (!r || typeof r !== 'object') continue;
    plan.rooms.push({
      id: uid(r.id),
      label: String(r.label ?? '').slice(0, 40),
      x: round2(clamp(num(r.x), -5000, 5000)),
      y: round2(clamp(num(r.y), -5000, 5000)),
      w: round2(clamp(num(r.w, 10), MIN_ROOM, MAX_ROOM)),
      h: round2(clamp(num(r.h, 10), MIN_ROOM, MAX_ROOM)),
      notes: String(r.notes ?? '').slice(0, 300),
    });
  }
  for (const m of (Array.isArray(raw.marks) ? raw.marks : []).slice(0, MAX_MARKS)) {
    if (!m || typeof m !== 'object') continue;
    const color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : MARK_COLORS[0];
    if (m.type === 'pen' && Array.isArray(m.pts)) {
      const pts = m.pts.slice(0, MAX_POINTS)
        .filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
        .map((p) => [round2(clamp(Number(p[0]), -5000, 5000)), round2(clamp(Number(p[1]), -5000, 5000))]);
      if (pts.length) plan.marks.push({ id: uid(m.id), type: 'pen', color, pts });
    } else if (m.type === 'text' && String(m.text ?? '').trim()) {
      plan.marks.push({
        id: uid(m.id), type: 'text', color,
        x: round2(clamp(num(m.x), -5000, 5000)), y: round2(clamp(num(m.y), -5000, 5000)),
        text: String(m.text).slice(0, 60),
      });
    }
  }
  return plan;
}

export function newRoom(label, x, y, w = 10, h = 10) {
  return {
    id: makeId(),
    label: String(label || '').slice(0, 40),
    x: snap(x), y: snap(y),
    w: clamp(snap(w), MIN_ROOM, MAX_ROOM), h: clamp(snap(h), MIN_ROOM, MAX_ROOM),
    notes: '',
  };
}

// ---------------------------------------------------------------- measuring
export const roomArea = (r) => r.w * r.h;
export const totalArea = (plan) => Math.round((plan?.rooms || []).reduce((s, r) => s + roomArea(r), 0));

// 12.5 -> 12' 6"   12 -> 12'   (nearest inch)
export function fmtFeet(v) {
  const totalIn = Math.round(Number(v) * 12);
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn - ft * 12;
  return inch ? `${ft}' ${inch}"` : `${ft}'`;
}

export function roomSizeText(r) {
  return `${fmtFeet(r.w)} × ${fmtFeet(r.h)}`;
}

export const roomAreaText = (r) => `${Math.round(roomArea(r))} sq ft`;

// Accepts 12, 12.5, 12', 12'6, 12' 6", 12ft, 12 ft 6 in. Returns NaN when it cannot read it.
export function parseFeet(input) {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s) return NaN;
  if (/^\d+(\.\d+)?$/.test(s)) return round2(Number(s));
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inches)?)?$/);
  if (!m) return NaN;
  return round2(Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0));
}

// -------------------------------------------------------------- hit testing
export const inRoom = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// The room on top at a point (later rooms draw over earlier ones).
export function hitRoom(plan, x, y) {
  for (let i = plan.rooms.length - 1; i >= 0; i -= 1) if (inRoom(plan.rooms[i], x, y)) return plan.rooms[i];
  return null;
}

// True when the point is on a room's bottom-right resize handle. tol is in feet.
export function hitHandle(room, x, y, tol) {
  return Math.abs(x - (room.x + room.w)) <= tol && Math.abs(y - (room.y + room.h)) <= tol;
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function markHit(m, x, y, tol) {
  if (m.type === 'pen') {
    if (m.pts.length === 1) return Math.hypot(x - m.pts[0][0], y - m.pts[0][1]) <= tol;
    for (let i = 1; i < m.pts.length; i += 1) {
      if (distToSegment(x, y, m.pts[i - 1][0], m.pts[i - 1][1], m.pts[i][0], m.pts[i][1]) <= tol) return true;
    }
    return false;
  }
  // text: a box starting at its point, about 0.8 ft per character wide (editor draws it to match)
  const w = Math.max(1.5, m.text.length * 0.8);
  return x >= m.x - tol && x <= m.x + w + tol && y >= m.y - 1.6 - tol && y <= m.y + tol;
}

export function hitMarkAt(plan, x, y, tol) {
  for (let i = plan.marks.length - 1; i >= 0; i -= 1) if (markHit(plan.marks[i], x, y, tol)) return plan.marks[i];
  return null;
}

// Drops points closer together than minDist, always keeping the first and last.
export function simplifyStroke(pts, minDist) {
  if (pts.length <= 2) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const last = out[out.length - 1];
    if (Math.hypot(pts[i][0] - last[0], pts[i][1] - last[1]) >= minDist) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ------------------------------------------------------------------- view
export function planBounds(plan) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const add = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const r of plan.rooms) { add(r.x, r.y); add(r.x + r.w, r.y + r.h); }
  for (const m of plan.marks) {
    if (m.type === 'pen') m.pts.forEach((p) => add(p[0], p[1]));
    else { add(m.x, m.y - 1.6); add(m.x + Math.max(1.5, m.text.length * 0.8), m.y); }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

// Scale (pixels per foot) and offset that fit the drawing in a box, centred. Empty plan: a 30 x 20 ft view.
export function fitView(bounds, width, height, pad = 24) {
  const b = bounds || { minX: 0, minY: 0, maxX: 30, maxY: 20 };
  const bw = Math.max(b.maxX - b.minX, 4);
  const bh = Math.max(b.maxY - b.minY, 4);
  const scale = clamp(Math.min((width - pad * 2) / bw, (height - pad * 2) / bh), 4, 80);
  return {
    scale,
    ox: (width - bw * scale) / 2 - b.minX * scale,
    oy: (height - bh * scale) / 2 - b.minY * scale,
  };
}

export const toWorld = (view, sx, sy) => ({ x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale });
export const toScreen = (view, x, y) => ({ x: x * view.scale + view.ox, y: y * view.scale + view.oy });

// -------------------------------------------------------------- photo counts
// How many (non-archived) photos are attached to each room of a sketch.
export function roomPhotoCounts(photos, sketchId) {
  const out = {};
  for (const p of photos || []) {
    if (p.archived_at || p.sketch_id !== sketchId || !p.room_key) continue;
    out[p.room_key] = (out[p.room_key] || 0) + 1;
  }
  return out;
}
