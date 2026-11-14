// Dehumidifier performance readings: the air going in (inlet) and coming out (outlet) of a unit, taken on a day.
// Grain depression is the inlet's grains per pound minus the outlet's. A working LGR unit drops the air by 20 or more grains;
// under 5 means it is barely removing water, so it is flagged. Pure data, no drawing.
//
// A reading on a unit (unit.dr):
//   { id, day: a day id, at: ISO time, by: { id, name }, inRh, inTemp, outRh, outTemp }   RH in %, temperatures in F
import { gpp } from './moisture.js';

export const MAX_DEHU_READINGS = 120;
export const LOW_DEPRESSION = 5; // grains per pound; under this the unit is not drying the air
export const GOOD_DEPRESSION = 20; // rule of thumb for a healthy LGR unit

const round1 = (n) => Math.round(n * 10) / 10;
const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).slice(0, 8);
const num = (v, lo, hi) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? round1(n) : null; };
const cleanBy = (by) => (by && typeof by === 'object' ? { id: by.id == null ? null : String(by.id).slice(0, 60), name: String(by.name ?? '').slice(0, 60) } : { id: null, name: '' });

// One reading from typed values; null when nothing usable. Needs at least one complete pair (RH and temperature) to mean anything.
export function makeDehuReading({ day, at = null, by = null, inRh, inTemp, outRh, outTemp }) {
  const r = { id: newId(), day, at: at || new Date().toISOString(), by: cleanBy(by), inRh: num(inRh, 0, 100), inTemp: num(inTemp, 0, 150), outRh: num(outRh, 0, 100), outTemp: num(outTemp, 0, 150) };
  const pair = (r.inRh != null && r.inTemp != null) || (r.outRh != null && r.outTemp != null);
  return pair ? r : null;
}

export function cleanDehuReadings(list, uid, dayIds) {
  const out = [];
  for (const e of (Array.isArray(list) ? list : []).slice(0, MAX_DEHU_READINGS)) {
    if (!e || typeof e !== 'object' || !dayIds.has(e.day)) continue;
    const r = makeDehuReading({ day: e.day, at: Number.isFinite(Date.parse(e.at)) ? new Date(e.at).toISOString() : null, by: e.by, inRh: e.inRh, inTemp: e.inTemp, outRh: e.outRh, outTemp: e.outTemp });
    if (r) out.push({ ...r, id: uid(e.id) });
  }
  return out;
}

// Grains per pound in, out and the drop between them (null where a part is missing).
export function depressionOf(r) {
  const gin = gpp(r.inTemp, r.inRh);
  const gout = gpp(r.outTemp, r.outRh);
  return { gin, gout, drop: gin != null && gout != null ? round1(gin - gout) : null };
}

// ok: a healthy drop   low: under LOW_DEPRESSION   fair: between   none: not enough readings to tell
export function depressionState(drop) {
  if (drop == null) return 'none';
  if (drop < LOW_DEPRESSION) return 'low';
  return drop >= GOOD_DEPRESSION ? 'ok' : 'fair';
}

// A unit's readings in time order, each with its numbers worked out: [{ r, gin, gout, drop, state }]
export function dehuHistory(plan, u) {
  const idx = new Map((plan.days || []).map((d, i) => [d.id, i]));
  return (u.dr || [])
    .filter((r) => idx.has(r.day))
    .map((r, i) => ({ r, i, di: idx.get(r.day) }))
    .sort((a, b) => (a.di - b.di) || (Date.parse(a.r.at) - Date.parse(b.r.at)) || (a.i - b.i))
    .map(({ r }) => { const d = depressionOf(r); return { r, ...d, state: depressionState(d.drop) }; });
}

// Units whose latest reading shows a low drop: [{ u, drop, day }]. Only dehumidifiers are checked.
export function lowDepressionUnits(plan) {
  const out = [];
  for (const u of plan.equipment || []) {
    if (!/^dehu|^desiccant$/.test(u.t)) continue;
    const h = dehuHistory(plan, u).filter((x) => x.drop != null);
    const last = h[h.length - 1];
    if (last && last.state === 'low') out.push({ u, drop: last.drop, day: last.r.day });
  }
  return out;
}

export function addDehuReading(u, reading) {
  return { ...u, dr: [...(u.dr || []), reading].slice(-MAX_DEHU_READINGS) };
}
export const removeDehuReading = (u, id) => ({ ...u, dr: (u.dr || []).filter((r) => r.id !== id) });
export const dropDehuDay = (list, dayId) => (list || []).map((u) => (u.dr ? { ...u, dr: u.dr.filter((r) => r.day !== dayId) } : u));
