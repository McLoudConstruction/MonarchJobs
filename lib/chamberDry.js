// Drying goals and equipment pick-up, one chamber at a time. Rooms dry at different speeds, so "is it dry?" and "pull the
// equipment" are answered for each chamber (rooms that share air and are dried together), not once for the job.
// A room that is in no chamber counts as a chamber of its own, so every room with readings or equipment is covered.
// Pure and tested. Gate: equipment leaves a chamber only when every room in it is at its dry standard (the owner can
// override with a reason). With no readings anywhere on the sketch there is nothing to measure, so nothing is held back.
import { buildReport } from './moistureReport.js';
import { EQUIPMENT_TYPES, equipmentOnSite, unitAt, unitCode } from './equipment.js';
import { hitRoom, roomTitle } from './sketch.js';

const DRYING_GROUPS = new Set(['Air movement', 'Dehumidifiers', 'Other']);

// [{ id, name, roomIds, state, points, dry, wet, dryDay, units, dehus, unitDays }]
//   state: 'dry' (every point in the chamber at its standard) | 'drying' (some above) | 'no_readings' (nothing measured in it yet)
//   units: drying units on site now, as unit objects (air cleaning gear is never held back)
export function chamberStatus(plan) {
  const days = plan.days || [];
  const rep = buildReport(plan);
  const lastDayId = days.length ? days[days.length - 1].id : null;
  const on = equipmentOnSite(plan, lastDayId).filter((r) => DRYING_GROUPS.has(EQUIPMENT_TYPES[r.u.t]?.group));
  const rooms = plan.rooms || [];
  const claimed = new Set();
  const defs = [];
  for (const c of plan.chambers || []) {
    const ids = c.rooms.filter((id) => rooms.some((r) => r.id === id));
    if (!ids.length) continue;
    ids.forEach((id) => claimed.add(id));
    defs.push({ id: c.id, name: c.name, roomIds: ids });
  }
  const groupFor = (roomId) => rep.groups.find((g) => g.room && g.room.id === roomId);
  const unitRoom = (r) => hitRoom(plan, r.x, r.y)?.id || null;
  for (const room of rooms) {
    if (claimed.has(room.id)) continue;
    const hasPoints = !!groupFor(room.id);
    const hasUnits = on.some((r) => unitRoom(r) === room.id);
    if (!hasPoints && !hasUnits) continue;
    defs.push({ id: `room:${room.id}`, name: roomTitle(room), roomIds: [room.id] });
  }
  const out = [];
  for (const d of defs) {
    const groups = d.roomIds.map(groupFor).filter(Boolean);
    const points = groups.reduce((n, g) => n + g.rows.length, 0);
    const dry = groups.reduce((n, g) => n + g.dry, 0);
    const wet = groups.reduce((n, g) => n + g.wet, 0);
    const state = !points ? 'no_readings' : groups.every((g) => g.allDry) ? 'dry' : 'drying';
    const dryIdxs = groups.map((g) => g.dryIdx).filter((i) => i != null);
    const dryIdx = state === 'dry' && dryIdxs.length ? Math.max(...dryIdxs) : null;
    const units = on.filter((r) => d.roomIds.includes(unitRoom(r))).map((r) => r.u);
    const daysSince = dryIdx == null ? 0 : Math.max(0, days.length - 1 - dryIdx);
    out.push({
      id: d.id, name: d.name, roomIds: d.roomIds, state, points, dry, wet,
      dryDay: dryIdx == null ? null : days[dryIdx], units,
      dehus: units.filter((u) => EQUIPMENT_TYPES[u.t].group === 'Dehumidifiers').length,
      unitDays: units.length * daysSince,
    });
  }
  return out;
}

// Does this sketch measure anything at all? Without readings the gate has nothing to hold equipment back for.
export const hasReadings = (plan) => (plan.moisture || []).some((p) => p.kind === 'reading' && (p.readings || []).length > 0);

// The chamber a unit stands in now, or null
export function chamberOfUnit(plan, u, chambers = chamberStatus(plan)) {
  const s = unitAt(plan, u, null);
  if (s.state !== 'on') return null;
  const room = hitRoom(plan, s.x, s.y);
  if (!room) return null;
  return chambers.find((c) => c.roomIds.includes(room.id)) || null;
}

// Can these units be picked up? Gives { ok, held: [{ chamber, units: [codes], why }] }. `held` lists the chambers that are not at
// their goal. Only drying units are held back (an air scrubber or a unit outside every room is not).
export function pickupCheck(plan, units) {
  if (!hasReadings(plan)) return { ok: true, held: [] };
  const chambers = chamberStatus(plan);
  const held = new Map();
  for (const u of units) {
    if (!DRYING_GROUPS.has(EQUIPMENT_TYPES[u.t]?.group)) continue;
    const c = chamberOfUnit(plan, u, chambers);
    if (!c || c.state === 'dry') continue;
    if (!held.has(c.id)) held.set(c.id, { chamber: c, units: [], why: c.state === 'no_readings' ? 'no readings in this chamber yet' : `${c.wet} point${c.wet === 1 ? ' is' : 's are'} above the dry standard` });
    held.get(c.id).units.push(unitCode(u));
  }
  return { ok: held.size === 0, held: [...held.values()] };
}

// One line for a chamber, for lists and the end-of-visit summary
export function chamberLine(c) {
  if (c.state === 'dry') return `${c.name}: dry${c.dryDay ? ` since ${c.dryDay.date}` : ''}`;
  if (c.state === 'no_readings') return `${c.name}: no readings yet`;
  return `${c.name}: ${c.dry} of ${c.points} points at the standard`;
}
