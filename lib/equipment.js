// Equipment on the job: air movers, dehumidifiers, air scrubbers... placed on the floorplan, so a customer or an
// adjuster can see how much was set and where, day by day. Data and geometry only (no drawing, no rooms), so the
// sketch model can use it without cycles.
//
// A unit in the plan:
//   { id, t: a key of EQUIPMENT_TYPES,
//     n: its number within its type (AM 1, AM 2...), never reused while the unit is on the sketch,
//     label: model or unit number (optional), note,
//     log: [{ id, action: 'placed'|'moved'|'removed', day: a day id, at: ISO time, by: { id, name }, x, y }] }
// The log is the whole story. Where a unit stands on a day comes from its last entry up to and including that day.
// Picking a unit up ('removed') keeps its spot, so putting it back needs no new placement.
// A unit is "on site" on the days from the one it was placed to the one before it was picked up.

export const MAX_EQUIPMENT = 300;
export const MAX_ACTIONS = 60;

export const EQUIPMENT_GROUPS = ['Air movement', 'Dehumidifiers', 'Air cleaning', 'Other'];

// code: the letters on the pin; plural: used in sentences ("4 air movers"); color: the pin
export const EQUIPMENT_TYPES = {
  airmover:  { label: 'Air mover (fan)',            plural: 'air movers',                code: 'AM', group: 'Air movement',     color: '#1c7ed6' },
  dehu:      { label: 'LGR dehumidifier',           plural: 'LGR dehumidifiers',         code: 'DH', group: 'Dehumidifiers',    color: '#c2255c' },
  dehuconv:  { label: 'Conventional dehumidifier',  plural: 'conventional dehumidifiers', code: 'CD', group: 'Dehumidifiers',    color: '#9c36b5' },
  desiccant: { label: 'Desiccant dehumidifier',     plural: 'desiccant dehumidifiers',   code: 'DD', group: 'Dehumidifiers',    color: '#7048e8' },
  scrubber:  { label: 'Air scrubber (HEPA)',        plural: 'air scrubbers',             code: 'AS', group: 'Air cleaning',     color: '#0b7285' },
  negair:    { label: 'Negative air machine',       plural: 'negative air machines',     code: 'NA', group: 'Air cleaning',     color: '#495057' },
  hydroxyl:  { label: 'Hydroxyl generator',         plural: 'hydroxyl generators',       code: 'HG', group: 'Air cleaning',     color: '#087f5b' },
  mat:       { label: 'Drying mat system',          plural: 'drying mat systems',        code: 'DM', group: 'Other',            color: '#e67700' },
  heater:    { label: 'Heater',                     plural: 'heaters',                   code: 'HT', group: 'Other',            color: '#c92a2a' },
  other:     { label: 'Other equipment',            plural: 'other equipment',           code: 'EQ', group: 'Other',            color: '#6c757d' },
};
export const EQUIPMENT_ORDER = Object.keys(EQUIPMENT_TYPES);

export const ACTION_TEXT = { placed: 'Placed', moved: 'Moved', removed: 'Picked up' };

const COORD = 5000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (n) => Math.round(n * 100) / 100;
const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).slice(0, 8);
const cleanBy = (by) => (by && typeof by === 'object' ? { id: by.id == null ? null : String(by.id).slice(0, 60), name: String(by.name ?? '').slice(0, 60) } : { id: null, name: '' });

const typeOf = (u) => EQUIPMENT_TYPES[u.t] || EQUIPMENT_TYPES.other;
export const unitCode = (u) => `${typeOf(u).code} ${u.n}`; // "AM 4"
export const unitLabel = (u) => typeOf(u).label;
export const typeRank = (t) => { const i = EQUIPMENT_ORDER.indexOf(t); return i < 0 ? EQUIPMENT_ORDER.length : i; };

// ------------------------------------------------------------------ making and cleaning
function entry(action, { day, at = null, by = null, x, y }) {
  return { id: newId(), action, day, at: at || new Date().toISOString(), by: cleanBy(by), x: round2(clamp(Number(x), -COORD, COORD)), y: round2(clamp(Number(y), -COORD, COORD)) };
}

// A new unit, placed at a spot on a day.
export function makeEquipment(type, n, x, y, { day, at = null, by = null, label = '', note = '' } = {}) {
  return {
    id: newId(), t: EQUIPMENT_TYPES[type] ? type : 'other', n,
    label: String(label ?? '').slice(0, 40), note: String(note ?? '').slice(0, 80),
    log: [entry('placed', { day, at, by, x, y })],
  };
}

// The next free number for a type: one more than the highest in use, so "AM 3" is never two machines.
export const nextEquipNumber = (list, type) => (list || []).filter((u) => u.t === type).reduce((m, u) => Math.max(m, Number(u.n) || 0), 0) + 1;

// Cleans a list read from storage: unknown types become "other", numbers are made unique per type, entries on days
// that no longer exist are dropped, and a unit with nothing left in its log is dropped. dayIds: a Set of the plan's day ids.
export function cleanEquipment(list, uid, dayIds) {
  const rows = (Array.isArray(list) ? list : []).slice(0, MAX_EQUIPMENT);
  const top = {};
  for (const u of rows) {
    const t = EQUIPMENT_TYPES[u?.t] ? u.t : 'other';
    const n = Math.floor(Number(u?.n));
    if (Number.isFinite(n) && n > (top[t] || 0) && n <= 9999) top[t] = n;
  }
  const used = new Set();
  const out = [];
  for (const u of rows) {
    if (!u || typeof u !== 'object') continue;
    const t = EQUIPMENT_TYPES[u.t] ? u.t : 'other';
    const log = [];
    for (const e of (Array.isArray(u.log) ? u.log : []).slice(0, MAX_ACTIONS)) {
      if (!e || typeof e !== 'object' || !ACTION_TEXT[e.action] || !dayIds.has(e.day) || !Number.isFinite(Number(e.x)) || !Number.isFinite(Number(e.y))) continue;
      const at = Number.isFinite(Date.parse(e.at)) ? new Date(e.at).toISOString() : new Date().toISOString();
      log.push({ id: uid(e.id), action: e.action, day: e.day, at, by: cleanBy(e.by), x: round2(clamp(Number(e.x), -COORD, COORD)), y: round2(clamp(Number(e.y), -COORD, COORD)) });
    }
    if (!log.length) continue;
    let n = Math.floor(Number(u.n));
    const key = (k) => `${t}|${k}`;
    if (!Number.isFinite(n) || n < 1 || n > 9999 || used.has(key(n))) { top[t] = (top[t] || 0) + 1; n = top[t]; }
    used.add(key(n));
    out.push({ id: uid(u.id), t, n, label: String(u.label ?? '').slice(0, 40), note: String(u.note ?? '').slice(0, 80), log });
  }
  return out;
}

// ------------------------------------------------------------------ where a unit stands
const dayIndexes = (plan) => new Map((plan.days || []).map((d, i) => [d.id, i]));

// The log in the order things happened: by day, then by time, then as entered.
export function orderedLog(plan, u, idx = dayIndexes(plan)) {
  return (u.log || [])
    .map((e, i) => ({ e, i, di: idx.has(e.day) ? idx.get(e.day) : -1 }))
    .filter((x) => x.di >= 0)
    .sort((a, b) => (a.di - b.di) || (Date.parse(a.e.at) - Date.parse(b.e.at)) || (a.i - b.i));
}

// Where a unit stands at the end of a day (no day: as it stands now).
//   { state: 'none'|'on'|'out', x, y, entry, since }
//   none  not placed yet on that day   on  in place, at x, y   out  picked up (at x, y, where it last stood)
// since is the entry that put it where it is.
export function unitAt(plan, u, dayId = null) {
  const idx = dayIndexes(plan);
  const limit = dayId != null && idx.has(dayId) ? idx.get(dayId) : Infinity;
  let last = null;
  for (const { e, di } of orderedLog(plan, u, idx)) if (di <= limit) last = e;
  if (!last) return { state: 'none', x: null, y: null, entry: null };
  return { state: last.action === 'removed' ? 'out' : 'on', x: last.x, y: last.y, entry: last };
}

// What shows on the floorplan for a day: units in place, plus units picked up that very day (shown faded, so a mistake can be undone).
//   [{ u, x, y, state: 'on'|'out', entry }] in type then number order
export function equipmentOnPlan(plan, dayId = null) {
  const out = [];
  for (const u of plan.equipment || []) {
    const s = unitAt(plan, u, dayId);
    if (s.state === 'on') out.push({ u, x: s.x, y: s.y, state: 'on', entry: s.entry });
    else if (s.state === 'out' && dayId != null && s.entry.day === dayId) out.push({ u, x: s.x, y: s.y, state: 'out', entry: s.entry });
  }
  return out.sort((a, b) => (typeRank(a.u.t) - typeRank(b.u.t)) || (a.u.n - b.u.n));
}
export const equipmentOnSite = (plan, dayId = null) => equipmentOnPlan(plan, dayId).filter((r) => r.state === 'on');

// The unit nearest a spot on the plan, within tol feet. Units picked up that day count too.
export function hitEquipment(plan, dayId, x, y, tol) {
  let best = null;
  let bestD = tol;
  for (const r of equipmentOnPlan(plan, dayId)) {
    const d = Math.hypot(r.x - x, r.y - y);
    if (d <= bestD) { best = r; bestD = d; }
  }
  return best;
}

// { total, byType: { airmover: 4, ... } } for the units in place on a day
export function equipmentCounts(plan, dayId = null) {
  const byType = {};
  let total = 0;
  for (const r of equipmentOnSite(plan, dayId)) { byType[r.u.t] = (byType[r.u.t] || 0) + 1; total += 1; }
  return { total, byType };
}

// "4 air movers · 2 LGR dehumidifiers" (a single unit reads "1 air mover")
export function countText(counts, sep = ' · ') {
  return EQUIPMENT_ORDER.filter((t) => counts.byType[t]).map((t) => {
    const n = counts.byType[t];
    const ty = EQUIPMENT_TYPES[t];
    return `${n} ${n === 1 ? singular(ty) : ty.plural}`;
  }).join(sep);
}
function singular(ty) {
  const p = ty.plural;
  if (p === 'other equipment') return p;
  return p.endsWith('s') ? p.slice(0, -1) : p;
}

// ------------------------------------------------------------------ changing a unit
// Each takes the plan (for its days) and the unit, and gives back the changed unit; the unit comes back as it was when nothing can be done.
const full = (u) => (u.log || []).length >= MAX_ACTIONS;

// Move a unit to a spot on a day. Moving it again on the day it was last set only corrects that spot.
export function moveUnit(plan, u, { x, y, day, at = null, by = null }) {
  const s = unitAt(plan, u, day);
  if (s.state !== 'on') return u;
  const log = orderedLog(plan, u);
  const last = log.length ? log[log.length - 1].e : null;
  if (last && last.day === day && last.action !== 'removed') {
    return { ...u, log: u.log.map((e) => (e.id === last.id ? { ...e, x: round2(x), y: round2(y) } : e)) };
  }
  if (full(u)) return u;
  return { ...u, log: [...u.log, entry('moved', { day, at, by, x, y })] };
}

// Pick a unit up on a day.
export function pickUpUnit(plan, u, { day, at = null, by = null }) {
  const s = unitAt(plan, u, day);
  if (s.state !== 'on' || full(u)) return u;
  return { ...u, log: [...u.log, entry('removed', { day, at, by, x: s.x, y: s.y })] };
}

// Put a picked-up unit back where it was, on a day.
export function putBackUnit(plan, u, { day, at = null, by = null }) {
  const s = unitAt(plan, u, day);
  if (s.state !== 'out' || full(u)) return u;
  // picked up and put back on the same day: it never left, so the pick-up just goes away
  if (s.entry.day === day) return { ...u, log: u.log.filter((e) => e.id !== s.entry.id) };
  return { ...u, log: [...u.log, entry('placed', { day, at, by, x: s.x, y: s.y })] };
}

// A day was deleted: what happened on it goes too, and a unit with nothing left goes with it.
export function dropEquipmentDay(list, dayId) {
  return (list || []).map((u) => ({ ...u, log: (u.log || []).filter((e) => e.day !== dayId) })).filter((u) => u.log.length);
}
export const equipmentActionsOnDay = (plan, dayId) => (plan.equipment || []).reduce((n, u) => n + (u.log || []).filter((e) => e.day === dayId).length, 0);

// ------------------------------------------------------------------ how long
const dayNum = (date) => { const [y, m, d] = String(date).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };

// Days a unit has been on site, counted in 24-hour days from the date it was placed: placed Nov 10 and picked up
// Nov 13 is 3 days, and one placed and picked up the same day is 1. A unit still in place counts through the day
// asked about (the latest day by default), so placed Nov 10 and still there on Nov 12 is 3. Picked up and put back
// counts each stretch.
export function daysOnSite(plan, u, asOfDayId = null) {
  const days = plan.days || [];
  const idx = dayIndexes(plan);
  const lastIdx = asOfDayId != null && idx.has(asOfDayId) ? idx.get(asOfDayId) : days.length - 1;
  if (lastIdx < 0) return 0;
  let total = 0;
  let start = null;
  for (const { e, di } of orderedLog(plan, u, idx)) {
    if (di > lastIdx) break;
    if (e.action === 'removed') {
      if (start != null) { total += Math.max(1, dayNum(days[di].date) - dayNum(days[start].date)); start = null; }
    } else if (start == null) start = di;
  }
  if (start != null) total += dayNum(days[lastIdx].date) - dayNum(days[start].date) + 1;
  return total;
}
