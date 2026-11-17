// What the read-only adjuster page shows for one sketch, worked out from its plan. Plain data, safe to send to a stranger:
// no staff names, no notes, no photos, no ids of people. Pure, so it is tested.
import { buildReport, pointWhat } from './moistureReport.js';
import { buildEquipment } from './equipmentLog.js';
import { dehuHistory } from './dehuReadings.js';
import { EQUIPMENT_TYPES, countText } from './equipment.js';
import { dateText, dayName } from './moistureDays.js';
import { fmtReading } from './moisture.js';
import { flattenFloors } from './floors.js';

export function adjusterView(wholePlan, name = 'Floorplan') {
  const plan = flattenFloors(wholePlan);
  const rep = buildReport(plan);
  const eq = buildEquipment(plan);
  const days = rep.days.map((d) => ({ name: dayName(rep.days, d.id), date: dateText(d.date) }));
  const total = rep.rows.length;
  const nDry = rep.rows.filter((r) => r.state === 'dry').length;
  const nWet = rep.rows.filter((r) => r.state === 'wet').length;
  const dehu = [];
  for (const u of plan.equipment || []) {
    if (!/^dehu|^desiccant$/.test(u.t)) continue;
    for (const h of dehuHistory(plan, u)) {
      dehu.push({ unit: `${EQUIPMENT_TYPES[u.t].code} ${u.n}`, day: dayName(rep.days, h.r.day), inRh: h.r.inRh, inTemp: h.r.inTemp, inGpp: h.gin == null ? null : Math.round(h.gin), outRh: h.r.outRh, outTemp: h.r.outTemp, outGpp: h.gout == null ? null : Math.round(h.gout), drop: h.drop, state: h.state });
    }
  }
  return {
    name,
    hasData: rep.hasData,
    status: { total, dry: nDry, wet: nWet, allDry: rep.allDry, dryDay: rep.dryDay ? `${dayName(rep.days, rep.dryDay.id)}, ${dateText(rep.dryDay.date)}` : '', lastDate: rep.lastDay ? dateText(rep.lastDay.date) : '' },
    days,
    rooms: rep.groups.map((g) => ({
      name: g.name, points: g.rows.length, dry: g.dry, wet: g.wet, allDry: g.allDry, dryDay: g.dryDay ? `${dayName(rep.days, g.dryDay.id)}, ${dateText(g.dryDay.date)}` : '',
      rows: g.rows.map((r) => ({ n: r.p.n, what: pointWhat(r.p), goal: r.goal == null ? null : fmtReading(r.goal), cells: r.cells.map((v) => (v == null ? null : fmtReading(v))), state: r.state })),
    })),
    equipment: eq.has ? {
      peak: eq.peak ? `${eq.peak.total} at once on ${dayName(rep.days, eq.peak.day.id)}: ${countText(eq.peak, ', ')}` : '',
      onSite: eq.onSiteNow.total ? `${eq.onSiteNow.total} still on site: ${countText(eq.onSiteNow, ', ')}` : 'All picked up',
      unitDays: eq.unitDays,
      units: eq.units.map((x) => ({ code: x.code, type: x.type, label: x.label || '', where: x.rooms.join(' > '), placed: x.placed ? `${dayName(rep.days, x.placed.day.id)}, ${dateText(x.placed.day.date)}` : '', pickedUp: x.pickedUp ? `${dayName(rep.days, x.pickedUp.day.id)}, ${dateText(x.pickedUp.day.date)}` : '', days: x.days })),
    } : null,
    dehu,
  };
}
