// Measuring helpers for the phone sketch: trace-the-room, closure and diagonal checks, shared-wall checks,
// snapping a room to its neighbour, and positioning an opening by distance from a corner. All lengths are in feet.
import { nearestWall } from './sketchObjects.js';

const round2 = (n) => Math.round(n * 100) / 100;
export const INCH = 1 / 12;
export const inchesOf = (ft) => Math.round(ft * 12 * 10) / 10; // feet to inches, one decimal

export const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }; // up, right, down, left on the screen
export const DIR_ARROW = { N: '↑', E: '→', S: '↓', W: '←' };

// Walk the steps [{ len, dir }] from (0,0). Returns every corner reached, starting with (0,0).
export function walkSteps(steps) {
  const pts = [[0, 0]];
  let x = 0; let y = 0;
  for (const s of steps) {
    const d = DIRS[s.dir];
    if (!d || !(s.len > 0)) continue;
    x = round2(x + d[0] * s.len); y = round2(y + d[1] * s.len);
    pts.push([x, y]);
  }
  return pts;
}

// How far the walk ends from where it began, in feet.
export function closureGap(steps) {
  const pts = walkSteps(steps);
  const e = pts[pts.length - 1];
  return Math.hypot(e[0], e[1]);
}

// The last wall that would close the room by itself: only possible when the end shares a row or column with the start.
export function autoCloseStep(steps) {
  const e = walkSteps(steps).pop();
  if (!e || (e[0] === 0 && e[1] === 0)) return null;
  if (Math.abs(e[0]) < 1e-6) return { len: round2(Math.abs(e[1])), dir: e[1] > 0 ? 'N' : 'S' };
  if (Math.abs(e[1]) < 1e-6) return { len: round2(Math.abs(e[0])), dir: e[0] > 0 ? 'W' : 'E' };
  return null;
}

// The room's corners from a finished walk. The walk must come back to its start (within tolFt); a small gap is closed by dropping the last point.
export function polygonFromSteps(steps, tolFt = 0.5) {
  const pts = walkSteps(steps);
  if (pts.length < 4) return { error: 'A room needs at least three walls.' };
  const e = pts[pts.length - 1];
  const gap = Math.hypot(e[0], e[1]);
  if (gap > tolFt) return { error: `The walls do not come back to the start (${inchesOf(gap)} in off). Add the last wall, or fix a length.`, gap };
  const poly = pts.slice(0, -1);
  // drop corners that sit in a straight line between their neighbours
  const clean = poly.filter((p, i) => {
    const a = poly[(i + poly.length - 1) % poly.length]; const b = poly[(i + 1) % poly.length];
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-6;
  });
  if (clean.length < 3) return { error: 'Those walls do not make a room.' };
  return { pts: clean, gap };
}

// Shared walls: where two rooms meet along nearly the same line and both quote a different length for it.
export function sharedWallMismatches(plan, tolIn = 1) {
  const out = [];
  const rooms = plan.rooms || [];
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const A = rooms[i]; const B = rooms[j];
      A.pts.forEach((a1, ai) => {
        const a2 = A.pts[(ai + 1) % A.pts.length];
        const la = Math.hypot(a2[0] - a1[0], a2[1] - a1[1]);
        if (la < 1) return;
        const ux = (a2[0] - a1[0]) / la; const uy = (a2[1] - a1[1]) / la;
        B.pts.forEach((b1, bi) => {
          const b2 = B.pts[(bi + 1) % B.pts.length];
          const lb = Math.hypot(b2[0] - b1[0], b2[1] - b1[1]);
          if (lb < 1) return;
          const off = (p) => Math.abs((p[0] - a1[0]) * -uy + (p[1] - a1[1]) * ux);
          if (off(b1) > 0.1 || off(b2) > 0.1) return; // not on the same line
          const t1 = (b1[0] - a1[0]) * ux + (b1[1] - a1[1]) * uy; const t2 = (b2[0] - a1[0]) * ux + (b2[1] - a1[1]) * uy;
          const overlap = Math.min(la, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2));
          if (overlap < 0.9 * Math.max(la, lb)) return; // one wall is only partly against the other: lengths can differ
          if (Math.abs(la - lb) * 12 > tolIn) out.push({ a: A.id, b: B.id, lenA: round2(la), lenB: round2(lb) });
        });
      });
    }
  }
  return out;
}

// Slide a room against the nearest neighbour when the gap is small (boxes only, so it suits square rooms).
export function snapToNeighbour(rooms, id, maxGap = 3) {
  const box = (r) => r.pts.reduce((b, p) => ({ x0: Math.min(b.x0, p[0]), y0: Math.min(b.y0, p[1]), x1: Math.max(b.x1, p[0]), y1: Math.max(b.y1, p[1]) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
  const me = rooms.find((r) => r.id === id);
  if (!me) return null;
  const m = box(me);
  let best = null;
  for (const r of rooms) {
    if (r.id === id) continue;
    const o = box(r);
    const overlapY = Math.min(m.y1, o.y1) - Math.max(m.y0, o.y0) > 0.5;
    const overlapX = Math.min(m.x1, o.x1) - Math.max(m.x0, o.x0) > 0.5;
    const tries = [];
    if (overlapY) { tries.push({ dx: o.x1 - m.x0, dy: 0 }); tries.push({ dx: o.x0 - m.x1, dy: 0 }); }
    if (overlapX) { tries.push({ dx: 0, dy: o.y1 - m.y0 }); tries.push({ dx: 0, dy: o.y0 - m.y1 }); }
    for (const t of tries) {
      const g = Math.abs(t.dx) + Math.abs(t.dy);
      if (g > 1e-6 && g <= maxGap && (!best || g < best.g)) best = { ...t, g };
    }
  }
  return best ? { dx: round2(best.dx), dy: round2(best.dy) } : null;
}

export const translateRoom = (room, dx, dy) => ({ ...room, pts: room.pts.map((p) => [round2(p[0] + dx), round2(p[1] + dy)]) });

// Where an opening sits on its wall: gaps from each end (edge of the opening to the corner), measured from the left or top end.
export function openingPlace(plan, obj) {
  const hit = nearestWall(plan, obj.x, obj.y, 1.5);
  if (!hit) return null;
  const flip = hit.b[0] < hit.a[0] - 1e-6 || (Math.abs(hit.b[0] - hit.a[0]) < 1e-6 && hit.b[1] < hit.a[1]);
  const start = flip ? hit.b : hit.a;
  const ux = flip ? -hit.ux : hit.ux; const uy = flip ? -hit.uy : hit.uy;
  const s = flip ? hit.len - hit.s : hit.s;
  const half = (obj.w || 0) / 2;
  return { len: hit.len, start, ux, uy, gapStart: round2(s - half), gapEnd: round2(hit.len - s - half), half };
}

// Move an opening so its edge sits gap feet from the start corner. Returns { x, y } or null when it would not fit.
export function placeOpeningAt(plan, obj, gap) {
  const pl = openingPlace(plan, obj);
  if (!pl || !(gap >= 0) || gap + 2 * pl.half > pl.len + 1e-6) return null;
  const s = gap + pl.half;
  return { x: round2(pl.start[0] + pl.ux * s), y: round2(pl.start[1] + pl.uy * s) };
}
