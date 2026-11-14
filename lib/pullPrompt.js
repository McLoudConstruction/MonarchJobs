// "This room is dry, pull its equipment": rooms whose every moisture point is at or under its dry standard, with the
// drying equipment still standing in them. Advice only; the person decides. Pure and tested.
//
// Equipment that cleans the air (scrubbers, negative air, hydroxyl) is never suggested. A dehumidifier is flagged, because one
// unit often serves a chamber wider than the room it stands in.
import { buildReport } from './moistureReport.js';
import { EQUIPMENT_TYPES, equipmentOnSite } from './equipment.js';
import { hitRoom, roomTitle } from './sketch.js';

const DRYING_GROUPS = new Set(['Air movement', 'Dehumidifiers', 'Other']);

// [{ roomId, roomName, dryDay: {id, date}, daysSince, units: [unit], dehus: n, unitDays }]
//   daysSince: days logged after the day the room reached dry (0 on the day it dried)
//   unitDays: equipment-days already added since it dried (units x daysSince): what pulling now stops adding to the bill
export function pullSuggestions(plan) {
  const days = plan.days || [];
  if (!days.length) return [];
  const last = days[days.length - 1];
  const rep = buildReport(plan);
  const on = equipmentOnSite(plan, last.id).filter((r) => DRYING_GROUPS.has(EQUIPMENT_TYPES[r.u.t]?.group));
  const out = [];
  for (const g of rep.groups) {
    if (!g.room || !g.allDry || !g.dryDay) continue;
    const units = on.filter((r) => hitRoom(plan, r.x, r.y)?.id === g.room.id).map((r) => r.u);
    if (!units.length) continue;
    const daysSince = Math.max(0, days.length - 1 - days.findIndex((d) => d.id === g.dryDay.id));
    out.push({ roomId: g.room.id, roomName: roomTitle(g.room), dryDay: g.dryDay, daysSince, units, dehus: units.filter((u) => EQUIPMENT_TYPES[u.t].group === 'Dehumidifiers').length, unitDays: units.length * daysSince });
  }
  return out;
}
