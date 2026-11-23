// On-call rotation: who is on call when. Pure, so the settings screen, the banners and the tests agree.
// The same rule is written in SQL (oncall_at, migration 047) for the alerts; tests/onCall.test.mjs holds both to the same answers.
//
// The rotation is an ordered list of people. Each week starts on Monday at the handoff hour (default 8:00, business time zone).
// The first week is the Monday in `start`; after the last person it wraps to the first. Anyone on time off that day is skipped
// for the next person in the list. A swap (override) covers its own stretch of time and wins over the rotation.
import { DEFAULT_TZ, zonedToUtcMs, addDaysStr, isoDow } from './booking.js';

export const DEFAULT_ONCALL = { oncall_enabled: false, oncall_order: [], oncall_start: '', oncall_handoff_hour: 8, oncall_wait_minutes: 15 };

function wallParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute };
}
const pad = (n) => String(n).padStart(2, '0');
const dateOf = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
const dayNumber = (s) => Math.round(new Date(`${s}T00:00:00Z`).getTime() / 86400000);

// The Monday that starts the on-call week containing this moment (before the handoff hour on Monday it is still last week).
export function weekStartFor(ms, tz = DEFAULT_TZ, handoffHour = 8) {
  const p = wallParts(ms, tz);
  const shifted = new Date(Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - handoffHour * 3600000);
  const day = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  return addDaysStr(day, -(isoDow(day) - 1));
}

// First person at or after position `from` (0-based, wrapping) who is active and not on time off that day. skip: never this person.
export function pickPerson(order, from, day, { isActive = () => true, timeOff = [], skip = null } = {}) {
  const n = order.length;
  for (let i = 0; i < n; i += 1) {
    const id = order[(((from + i) % n) + n) % n];
    if (!id || id === skip || !isActive(id)) continue;
    if (timeOff.some((t) => t.staff_id === id && day >= t.starts_on && day <= t.ends_on)) continue;
    return id;
  }
  return null;
}

// { staffId, until (ms), swapped } or null when nobody is set up. cfg: settings fields plus { tz, overrides, timeOff, isActive }.
export function onCallAt(ms, cfg) {
  const tz = cfg.tz || DEFAULT_TZ;
  const hand = Number.isFinite(Number(cfg.oncall_handoff_hour)) ? Number(cfg.oncall_handoff_hour) : 8;
  const isActive = cfg.isActive || (() => true);
  const swap = (cfg.overrides || [])
    .filter((o) => new Date(o.starts_at).getTime() <= ms && new Date(o.ends_at).getTime() > ms && isActive(o.staff_id))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
  if (swap) return { staffId: swap.staff_id, until: new Date(swap.ends_at).getTime(), swapped: true };
  const order = cfg.oncall_order || [];
  if (!order.length || !cfg.oncall_start) return null;
  const wk = weekStartFor(ms, tz, hand);
  const idx = ((((dayNumber(wk) - dayNumber(cfg.oncall_start)) / 7) % order.length) + order.length) % order.length;
  const day = dateOf(wallParts(ms, tz));
  const staffId = pickPerson(order, idx, day, { isActive, timeOff: cfg.timeOff });
  const [y, m, d] = addDaysStr(wk, 7).split('-').map(Number);
  return { staffId, until: zonedToUtcMs(y, m, d, hand, 0, tz), swapped: false, weekStart: wk };
}

// The next `count` weeks, for the settings preview: [{ weekStart, startsAt, staffId }]
export function upcomingWeeks(fromMs, count, cfg) {
  const tz = cfg.tz || DEFAULT_TZ;
  const hand = Number.isFinite(Number(cfg.oncall_handoff_hour)) ? Number(cfg.oncall_handoff_hour) : 8;
  const out = [];
  let wk = weekStartFor(fromMs, tz, hand);
  for (let i = 0; i < count; i += 1) {
    const [y, m, d] = wk.split('-').map(Number);
    const startsAt = zonedToUtcMs(y, m, d, hand, 0, tz);
    // ask at a moment safely inside the week (a day after it starts) so a swap on Monday morning does not hide the rotation
    const probe = startsAt + 24 * 3600000;
    const r = onCallAt(probe, { ...cfg, overrides: [] });
    out.push({ weekStart: wk, startsAt, staffId: r?.staffId || null });
    wk = addDaysStr(wk, 7);
  }
  return out;
}

export function validateOnCall(f) {
  const order = Array.isArray(f.oncall_order) ? f.oncall_order.filter(Boolean) : [];
  if (new Set(order).size !== order.length) return { error: 'Each person can be in the rotation only once.' };
  if (order.length > 30) return { error: 'The rotation can have up to 30 people.' };
  const start = String(f.oncall_start || '').trim();
  if (order.length && !/^\d{4}-\d{2}-\d{2}$/.test(start)) return { error: 'Pick the Monday the rotation starts.' };
  if (start && isoDow(start) !== 1) return { error: 'The start date must be a Monday.' };
  const hand = Number(f.oncall_handoff_hour);
  if (!Number.isInteger(hand) || hand < 0 || hand > 23) return { error: 'The handoff hour must be between 0 and 23.' };
  const wait = Number(f.oncall_wait_minutes);
  if (!Number.isInteger(wait) || wait < 5 || wait > 120) return { error: 'The wait must be between 5 and 120 minutes.' };
  if (f.oncall_enabled && !order.length) return { error: 'Add at least one person to the rotation before turning it on.' };
  return { value: { oncall_enabled: !!f.oncall_enabled, oncall_order: order, oncall_start: start || null, oncall_handoff_hour: hand, oncall_wait_minutes: wait } };
}

export const handoffLabel = (h) => new Date(Date.UTC(2000, 0, 1, h, 0)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

// ------------------------------------------------------------------ rotation planning and the calendar

// Days of time off a person has inside the week that starts on weekStart (a Monday, 'YYYY-MM-DD'), 0 to 7.
export function offDaysInWeek(staffId, weekStart, timeOff) {
  let n = 0;
  for (let i = 0; i < 7; i += 1) {
    const day = addDaysStr(weekStart, i);
    if ((timeOff || []).some((t) => t.staff_id === staffId && day >= t.starts_on && day <= t.ends_on)) n += 1;
  }
  return n;
}

// How a given order plays out over the next `weeks` weeks from startMonday:
// { weeksHit: weeks whose on-call person has time off that week, daysHit: total days off that land on their own week }
export function rotationConflicts(order, startMonday, timeOff, weeks = 26) {
  let weeksHit = 0;
  let daysHit = 0;
  if (!order.length) return { weeksHit, daysHit };
  for (let w = 0; w < weeks; w += 1) {
    const d = offDaysInWeek(order[w % order.length], addDaysStr(startMonday, w * 7), timeOff);
    if (d > 0) { weeksHit += 1; daysHit += d; }
  }
  return { weeksHit, daysHit };
}

function* permutations(arr) {
  if (arr.length <= 1) { yield arr.slice(); return; }
  for (let i = 0; i < arr.length; i += 1) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}

// The order with the fewest on-call weeks that collide with the on-call person's own time off. Ties keep the order given
// (so nothing changes when time off makes no difference). Tries every order for up to 7 people, and improves by swapping for more.
export function bestOrder(people, startMonday, timeOff, weeks = 26) {
  const base = people.slice();
  const score = (o) => { const c = rotationConflicts(o, startMonday, timeOff, weeks); return c.weeksHit * 100 + c.daysHit; };
  if (base.length <= 1) return { order: base, ...rotationConflicts(base, startMonday, timeOff, weeks) };
  let best = base; let bestScore = score(base);
  if (base.length <= 7) {
    for (const p of permutations(base)) { const s = score(p); if (s < bestScore) { best = p; bestScore = s; } }
  } else {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < best.length; i += 1) for (let j = i + 1; j < best.length; j += 1) {
        const t = best.slice(); [t[i], t[j]] = [t[j], t[i]];
        const s = score(t);
        if (s < bestScore) { best = t; bestScore = s; improved = true; }
      }
    }
  }
  return { order: best, ...rotationConflicts(best, startMonday, timeOff, weeks) };
}

// What the calendar shows for one day (date: 'YYYY-MM-DD'): who is on call (at noon), who the rotation had, who is off.
export function dayInfo(date, cfg) {
  const tz = cfg.tz || DEFAULT_TZ;
  const [y, m, d] = date.split('-').map(Number);
  const noon = zonedToUtcMs(y, m, d, 12, 0, tz);
  const actual = onCallAt(noon, cfg);
  const planned = onCallAt(noon, { ...cfg, overrides: [], timeOff: [] });
  const off = [...new Set((cfg.timeOff || []).filter((t) => date >= t.starts_on && date <= t.ends_on).map((t) => t.staff_id))];
  const staffId = actual?.staffId || null;
  const plannedId = planned?.staffId || null;
  return {
    date, staffId, plannedId, swapped: !!actual?.swapped, off,
    covering: !!staffId && !!plannedId && staffId !== plannedId && !actual?.swapped,
    plannedOff: !!plannedId && off.includes(plannedId),
  };
}
