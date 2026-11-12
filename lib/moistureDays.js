// Moisture days: a loss is logged over several days, so every reading belongs to a day.
// plan.days = [{ id, date: 'YYYY-MM-DD' }], oldest first; the first is the "Initial loss", "Day 2" is simply the second one.
// A reading carries `day` (a day id) and `at` (when it was taken).
import { sortedReadings, goalFor } from './moisture.js';

export const MAX_DAYS = 120;
const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).slice(0, 8);
const pad = (n) => String(n).padStart(2, '0');

export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local calendar date
export const todayKey = () => dateKey(new Date());
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T12:00:00`));

// "2026-11-12" -> "Nov 12"
export function dateText(key) {
  if (!validDate(key)) return '';
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// A reading made for a past day is stamped midday on that day; for today it is stamped now.
export function atForDay(day) {
  if (!day || day.date === todayKey()) return new Date().toISOString();
  return new Date(`${day.date}T12:00:00`).toISOString();
}

export function cleanDays(list, uid = (x) => x || newId()) {
  const seen = new Set();
  const out = [];
  for (const d of Array.isArray(list) ? list : []) {
    if (!d || !validDate(d.date) || seen.has(d.date)) continue;
    seen.add(d.date);
    out.push({ id: uid(d.id), date: d.date });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, MAX_DAYS);
}

// Readings with no day (made before days existed) are filed under the day they were taken, creating the days that are missing.
// Returns { days, moisture }.
export function attachDays(days, moisture) {
  const list = [...days];
  const byDate = new Map(list.map((d) => [d.date, d]));
  const ids = new Set(list.map((d) => d.id));
  const dayFor = (at) => {
    const key = dateKey(new Date(at));
    if (!byDate.has(key)) {
      const d = { id: newId(), date: key };
      byDate.set(key, d); list.push(d); ids.add(d.id);
    }
    return byDate.get(key).id;
  };
  const out = (moisture || []).map((p) => ({ ...p, readings: (p.readings || []).map((r) => (r.day && ids.has(r.day) ? r : { ...r, day: dayFor(r.at) })) }));
  list.sort((a, b) => a.date.localeCompare(b.date));
  return { days: list.slice(0, MAX_DAYS), moisture: out };
}

export const dayNumber = (days, id) => days.findIndex((d) => d.id === id) + 1;
// The first day is the initial loss; after it come Day 2, Day 3...
export const dayName = (days, id) => { const n = dayNumber(days, id); return n === 1 ? 'Initial loss' : n ? `Day ${n}` : ''; };

// Adds a day for a date (today by default). Returns { plan, id, added } and leaves the plan alone when that date already has a day.
export function addDay(plan, date = todayKey()) {
  const days = plan.days || [];
  const have = days.find((d) => d.date === date);
  if (have) return { plan, id: have.id, added: false };
  if (!validDate(date) || days.length >= MAX_DAYS) return { plan, id: days.length ? days[days.length - 1].id : null, added: false };
  const day = { id: newId(), date };
  return { plan: { ...plan, days: [...days, day].sort((a, b) => a.date.localeCompare(b.date)) }, id: day.id, added: true };
}

export const removeDay = (plan, id) => ({
  ...plan,
  days: (plan.days || []).filter((d) => d.id !== id),
  moisture: (plan.moisture || []).map((p) => ({ ...p, readings: p.readings.filter((r) => r.day !== id) })),
});

export const readingsOnDay = (p, dayId) => sortedReadings(p).filter((r) => r.day === dayId);
export const countOnDay = (plan, dayId) => (plan.moisture || []).filter((p) => (p.readings || []).some((r) => r.day === dayId)).length;

// The plan as it stood at the end of a day: each point keeps its readings up to and including that day. A point with
// nothing on that day is marked `stale`, so it shows as still to be read. Without a day, the plan comes back as it is.
export function dayView(plan, dayId) {
  const days = plan.days || [];
  const idx = days.findIndex((d) => d.id === dayId);
  if (idx < 0) return plan;
  const upTo = new Set(days.slice(0, idx + 1).map((d) => d.id));
  return {
    ...plan,
    moisture: (plan.moisture || []).map((p) => {
      const readings = p.readings.filter((r) => upTo.has(r.day));
      return { ...p, readings, stale: !readings.some((r) => r.day === dayId) };
    }),
  };
}

// One row per point, one column per day (the day's last reading), for a customer-friendly drying summary.
export function dailyMatrix(plan) {
  const days = plan.days || [];
  return (plan.moisture || []).map((p) => {
    const cells = days.map((d) => {
      const r = readingsOnDay(p, d.id);
      return r.length ? r[r.length - 1].val : null;
    });
    return { p, goal: goalFor(plan, p), cells };
  });
}

