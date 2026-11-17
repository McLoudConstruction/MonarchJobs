// Daily burn: what a restoration job costs the company each calendar day, and the running total.
//   equipment  every machine on site that day x the daily cost of its kind (the owner sets those on the Costs tab)
//   labor      the hours logged for that day x the hourly cost each entry was made with
// Purchases are not part of it (they are not a daily cost). Owner only: it holds the company's own costs. Names no one:
// labor is shown as hours and dollars, never by person. Pure, so the report and the tests agree. Money is whole cents.
import { normalizePlan } from './sketch.js';
import { EQUIPMENT_ORDER, EQUIPMENT_TYPES, calendarDatesOnSite } from './equipment.js';
import { isLive, timeEntryCents } from './jobCost.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const dayNum = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const isoOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

// sketches: [{ plan }]; rates: { type: dailyCents }; time: job_time_entries rows.
// Returns { days: [{ date, units: [{ type, label, count }], unitCount, equipmentCents, laborHours, laborCents, dayCents, runningCents }],
//           totals, avgCents, peak, missing, empty }
export function dailyBurn(sketches, rates = {}, time = []) {
  const perDay = new Map(); // date -> { types: Map(type -> count), hours, laborCents }
  const slot = (d) => { if (!perDay.has(d)) perDay.set(d, { types: new Map(), hours: 0, laborCents: 0 }); return perDay.get(d); };
  const used = new Set();
  for (const s of sketches || []) {
    const plan = normalizePlan(s.plan);
    for (const u of plan.equipment || []) {
      for (const d of calendarDatesOnSite(plan, u)) {
        const t = slot(d).types;
        t.set(u.t, (t.get(u.t) || 0) + 1);
        used.add(u.t);
      }
    }
  }
  for (const e of (time || []).filter(isLive)) {
    const d = String(e.worked_on || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const c = slot(d);
    c.hours += num(e.hours);
    c.laborCents += timeEntryCents(e);
  }
  if (!perDay.size) return { days: [], totals: { equipmentCents: 0, laborCents: 0, laborHours: 0, totalCents: 0, unitDays: 0 }, avgCents: 0, peak: null, missing: [], empty: true };

  const keys = [...perDay.keys()].sort();
  const first = dayNum(keys[0]);
  const last = dayNum(keys[keys.length - 1]);
  const days = [];
  let running = 0;
  for (let n = first; n <= last; n += 1) { // every date between, so a quiet day shows as $0 instead of vanishing
    const date = isoOf(n);
    const c = perDay.get(date) || { types: new Map(), hours: 0, laborCents: 0 };
    const units = EQUIPMENT_ORDER.filter((t) => c.types.has(t)).map((t) => ({ type: t, label: EQUIPMENT_TYPES[t].label, count: c.types.get(t) }));
    const equipmentCents = units.reduce((s, u) => s + Math.round(u.count * num(rates?.[u.type])), 0);
    const laborHours = Math.round(c.hours * 100) / 100;
    const dayCents = equipmentCents + c.laborCents;
    running += dayCents;
    days.push({ date, units, unitCount: units.reduce((s, u) => s + u.count, 0), equipmentCents, laborHours, laborCents: c.laborCents, dayCents, runningCents: running });
  }
  const totals = {
    equipmentCents: days.reduce((s, d) => s + d.equipmentCents, 0),
    laborCents: days.reduce((s, d) => s + d.laborCents, 0),
    laborHours: Math.round(days.reduce((s, d) => s + d.laborHours, 0) * 100) / 100,
    totalCents: running,
    unitDays: days.reduce((s, d) => s + d.unitCount, 0),
  };
  const peak = days.reduce((m, d) => (!m || d.dayCents > m.dayCents ? d : m), null);
  return {
    days, totals, avgCents: Math.round(running / days.length), peak,
    missing: EQUIPMENT_ORDER.filter((t) => used.has(t) && !(num(rates?.[t]) > 0)), // used, but no daily cost set: counted as $0
    empty: false,
  };
}
