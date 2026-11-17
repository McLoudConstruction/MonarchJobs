// Job costing, for the owner only. Pure, so the tab and the tests agree. Money is whole cents.
//
// A job's cost is three things:
//   purchases        what was bought for it (materials, dump fees, fuel...), typed in
//   labor            hours worked x the hourly cost of the person (the rate is copied onto each entry when it is made)
//   equipment        every machine on the sketch's equipment log, counted in CALENDAR days on site (the day it was placed and the
//                    day it was picked up both count, however few hours) x the daily cost of that kind of machine. Worked out
//                    from the sketches each time, so it is never out of date and nothing is stored for it.
// Voided purchases and hours are kept for the trail but never counted.
import { normalizePlan } from './sketch.js';
import { EQUIPMENT_ORDER, EQUIPMENT_TYPES, calendarDatesOnSite } from './equipment.js';

export const COST_CATEGORIES = {
  materials: 'Materials',
  equipment_rental: 'Equipment rental',
  disposal: 'Disposal / dump fees',
  fuel: 'Fuel',
  subcontract: 'Subcontract',
  other: 'Other',
};
export const COST_CATEGORY_KEYS = Object.keys(COST_CATEGORIES);
export const costCategoryLabel = (k) => COST_CATEGORIES[k] || 'Other';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Cost of one time entry: hours x the rate it was made with, rounded to the cent.
export const timeEntryCents = (e) => Math.round(num(e?.hours) * num(e?.rate_cents));
export const isLive = (row) => !row?.voided_at;

export const purchaseTotalCents = (rows) => (rows || []).filter(isLive).reduce((s, r) => s + num(r.amount_cents), 0);
export const laborTotals = (rows) => {
  const live = (rows || []).filter(isLive);
  return { hours: Math.round(live.reduce((s, r) => s + num(r.hours), 0) * 100) / 100, cents: live.reduce((s, r) => s + timeEntryCents(r), 0) };
};

// Equipment run time from a job's sketches ([{ id, name, plan }]) and the daily rates ({ type: cents }).
//   rows       one per kind of machine used: { type, label, units, unitDays, dailyCents, costCents, hasRate }
//   unitDays   every machine-day on the job
//   costCents  the sum (kinds with no rate cost nothing until a rate is set)
//   missing    the kinds that were used but have no daily rate yet
export function equipmentRunTime(sketches, rates = {}) {
  const byType = new Map();
  for (const s of sketches || []) {
    const plan = normalizePlan(s.plan);
    for (const u of plan.equipment || []) {
      const days = calendarDatesOnSite(plan, u).length;
      if (days <= 0) continue;
      const cur = byType.get(u.t) || { units: 0, unitDays: 0 };
      cur.units += 1; cur.unitDays += days;
      byType.set(u.t, cur);
    }
  }
  const rows = EQUIPMENT_ORDER.filter((t) => byType.has(t)).map((t) => {
    const { units, unitDays } = byType.get(t);
    const rate = rates && rates[t] != null ? num(rates[t]) : null;
    return { type: t, label: EQUIPMENT_TYPES[t].label, units, unitDays, dailyCents: rate, hasRate: rate != null && rate > 0, costCents: rate ? Math.round(unitDays * rate) : 0 };
  });
  return {
    rows,
    unitDays: rows.reduce((s, r) => s + r.unitDays, 0),
    costCents: rows.reduce((s, r) => s + r.costCents, 0),
    missing: rows.filter((r) => !r.hasRate).map((r) => r.type),
  };
}

// What the job is worth to compare the cost against: the newest invoice that is not void (a return-visit invoice lists the
// whole job, so its total is the job's total), else what the customer approved on the estimate. { cents, source } or null.
export function jobRevenue(invoices, estimateCents = null) {
  const live = (invoices || []).filter((i) => i.status !== 'void').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (live.length) return { cents: num(live[0].total_cents), source: 'invoice', number: live[0].invoice_number };
  if (estimateCents != null && Number(estimateCents) > 0) return { cents: num(estimateCents), source: 'estimate' };
  return null;
}

// The summary at the top of the tab.
export function costSummary({ purchases = [], time = [], equipment = null, revenue = null }) {
  const p = purchaseTotalCents(purchases);
  const l = laborTotals(time);
  const e = equipment ? equipment.costCents : 0;
  const total = p + l.cents + e;
  const rev = revenue ? revenue.cents : null;
  const margin = rev != null ? rev - total : null;
  return {
    purchasesCents: p, laborCents: l.cents, laborHours: l.hours, equipmentCents: e, equipmentUnitDays: equipment ? equipment.unitDays : 0,
    totalCents: total, revenueCents: rev, marginCents: margin,
    marginPercent: rev != null && rev > 0 ? Math.round((margin / rev) * 1000) / 10 : null,
  };
}

// A purchase's total by category, biggest first, for the breakdown.
export function purchasesByCategory(rows) {
  const m = new Map();
  for (const r of (rows || []).filter(isLive)) m.set(r.category, (m.get(r.category) || 0) + num(r.amount_cents));
  return [...m.entries()].map(([category, cents]) => ({ category, label: costCategoryLabel(category), cents })).sort((a, b) => b.cents - a.cents);
}

// Hours typed in the box: "3.5", "3:30", "3h 30m", "3 hrs". Gives hours as a number, or null when it is not a time.
export function parseHours(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return null;
  let h = null;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (m) h = Number(m[1]) + Number(m[2]) / 60;
  else if ((m = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)?\s*(?:(\d{1,2})\s*(?:m|min|mins|minutes?))?$/.exec(t))) h = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
  else return null;
  h = Math.round(h * 100) / 100;
  return h > 0 && h <= 24 ? h : null;
}
