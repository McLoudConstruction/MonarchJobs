// Placing, moving and picking objects on the sketch. Pure geometry, no drawing.
import { OBJECT_TYPES, objectShownOn } from './objectTypes.js';
import { pointInPoly } from './sketch.js';

const snapTo = (v, step) => Math.round(v / step) * step;
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (n) => Math.round(n * 100) / 100;

// The wall nearest a point: { room, a, b, len, u: [ux, uy] along the wall, n: [nx, ny] into the room, s: distance along from a, dist }
export function nearestWall(plan, x, y, tol) {
  let best = null;
  for (const room of plan.rooms || []) {
    if (room.pts.length < 3) continue;
    room.pts.forEach((a, i) => {
      const b = room.pts[(i + 1) % room.pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) return;
      const ux = (b[0] - a[0]) / len;
      const uy = (b[1] - a[1]) / len;
      const s = clampN((x - a[0]) * ux + (y - a[1]) * uy, 0, len);
      const dist = Math.hypot(x - (a[0] + ux * s), y - (a[1] + uy * s));
      if (dist > tol || (best && dist >= best.dist)) return;
      let nx = -uy;
      let ny = ux;
      const qx = a[0] + ux * s;
      const qy = a[1] + uy * s;
      if (!pointInPoly(room.pts, qx + nx * 0.1, qy + ny * 0.1)) { nx = -nx; ny = -ny; }
      best = { room, a, b, len, ux, uy, nx, ny, s, dist };
    });
  }
  return best;
}

// Angle (degrees) that makes local +y point along the inward normal.
const angleFor = (nx, ny) => ((((Math.atan2(-nx, ny) * 180) / Math.PI) % 360) + 360) % 360;

// Where an object of this type goes when put at (x, y): it snaps to the wall for wall items and
// sits flush against a nearby wall for floor items, unless free (Alt) is held.
// Returns { x, y, r }.
export function placeObject(plan, type, x, y, { w, d, r = 0, free = false } = {}) {
  const t = OBJECT_TYPES[type];
  const ow = w ?? t.w;
  const od = d ?? t.d;
  const grid = (v) => round2(snapTo(v, 0.25));
  if (!free && (t.mode === 'wall' || t.mode === 'wallpoint')) {
    const hit = nearestWall(plan, x, y, 2.5);
    if (hit) {
      const half = Math.min(ow / 2, hit.len / 2);
      const s = clampN(snapTo(hit.s, 0.25), half, hit.len - half);
      const px = hit.a[0] + hit.ux * s;
      const py = hit.a[1] + hit.uy * s;
      return { x: round2(px), y: round2(py), r: round2(angleFor(hit.nx, hit.ny)) };
    }
  }
  if (!free && t.mode === 'box') {
    const hit = nearestWall(plan, x, y, od / 2 + 1);
    if (hit) {
      const half = Math.min(ow / 2, hit.len / 2);
      const s = clampN(snapTo(hit.s, 0.25), half, hit.len - half);
      const px = hit.a[0] + hit.ux * s + hit.nx * (od / 2);
      const py = hit.a[1] + hit.uy * s + hit.ny * (od / 2);
      return { x: round2(px), y: round2(py), r: round2(angleFor(hit.nx, hit.ny)) };
    }
  }
  return { x: grid(x), y: grid(y), r };
}

// A point in an object's own frame (x along its width, y along its depth), origin at the centre.
export function toLocal(o, x, y) {
  const a = (-o.r * Math.PI) / 180;
  const dx = x - o.x;
  const dy = y - o.y;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

// The object under a point, within tol feet. Later objects are on top.
export function hitObject(plan, x, y, tol, filter = 'all') {
  const list = plan.objects || [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const o = list[i];
    if (!objectShownOn(o, filter)) continue;
    const t = OBJECT_TYPES[o.t];
    const [lx, ly] = toLocal(o, x, y);
    if (t.mode === 'point' || t.mode === 'wallpoint') {
      const rad = Math.max(Math.max(o.w, o.d) / 2, 0.45) + tol * 0.5;
      const cy = t.mode === 'wallpoint' ? ly - Math.max(o.d, 0.5) / 2 : ly;
      if (Math.hypot(lx, cy) <= rad) return o;
    } else {
      const hy = t.mode === 'wall' ? Math.max(o.d, 0.8) / 2 : o.d / 2;
      if (Math.abs(lx) <= o.w / 2 + tol * 0.3 && Math.abs(ly) <= hy + tol * 0.3) return o;
    }
  }
  return null;
}

// A stretch of a wall (from sa to sb feet along it) as an object's position: { x, y, r, w }.
export function wallSpan(hit, sa, sb) {
  const lo = Math.min(sa, sb);
  const hi = Math.max(sa, sb);
  const mid = (lo + hi) / 2;
  return { x: round2(hit.a[0] + hit.ux * mid), y: round2(hit.a[1] + hit.uy * mid), r: round2(angleFor(hit.nx, hit.ny)), w: round2(hi - lo) };
}
