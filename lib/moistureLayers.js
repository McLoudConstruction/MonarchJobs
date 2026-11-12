// Layers for the Moisture floorplan: the plan itself, then one layer for every affected area drawn on the sketch.
import { AREA_KINDS, SURFACES, areaOutline, pointInPoly } from './sketch.js';
import { areaStyle } from './sketchDraw.js';

const SHORT = { floor: 'floor', wall: 'wall', ceiling: 'ceiling' };

// The rooms an area touches, found from the middle of its outline and each of its corners.
function roomsFor(plan, area) {
  const pts = areaOutline(area) || [];
  if (!pts.length) return [];
  const probes = [[pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length], ...pts];
  const hit = [];
  for (const r of plan.rooms || []) if (probes.some(([x, y]) => pointInPoly(r.pts, x, y))) hit.push(r);
  return hit;
}

// [{ id, name, detail, color, kind }] in drawing order; two areas of one kind in one room are numbered (Water 1, Water 2).
export function areaLayers(plan) {
  const seen = {};
  return (plan.areas || []).map((a) => {
    const rooms = roomsFor(plan, a);
    const where = rooms.map((r) => r.label).filter(Boolean).slice(0, 2).join(', ') || 'Unnamed room';
    const base = a.kind === 'water' ? `${AREA_KINDS.water} cat ${a.cat || 1}` : AREA_KINDS[a.kind] || 'Area';
    const key = `${base}|${where}`;
    seen[key] = (seen[key] || 0) + 1;
    return {
      id: a.id,
      kind: a.kind,
      name: `${base} · ${where}`,
      n: seen[key],
      detail: (a.surfaces || []).map((s) => SHORT[s] || s).join(' + ') || SURFACES.floor.toLowerCase(),
      color: areaStyle(a).line,
    };
  }).map((l, i, all) => ({ ...l, name: all.filter((o) => o.name === l.name).length > 1 ? `${l.name} (${l.n})` : l.name }));
}
