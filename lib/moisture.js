// Moisture points: the spots on the sketch where a moisture reading was taken, and the readings taken there
// over time. Data and geometry only (no drawing), so the sketch model can use it without cycles.
//
// A point in the plan:
//   { id, n, x, y,                 n is the number shown on the pin; it stays the same for the life of the point
//     surface: 'floor'|'wall'|'ceiling',
//     material: a key of MOISTURE_MATERIALS,
//     type: 'mc'|'wme'|'rel',      the scale the meter reads in; every reading at this point uses it, so they can be compared
//     goal: number|null,           dry standard, in the same scale (a reading at or under it is dry)
//     h: feet up the wall|null,    for readings on a wall
//     readings: [{ id, at: ISO time, by: { id, name }, val, rh, temp, note }] }
//   rh is the room humidity (% relative humidity) and temp the air temperature (F) when the reading was taken.
// Taking the same spot again adds a reading to the same point, so each recheck lines up with the last.
// The job's dry standards live beside the points, in plan.standards: { material: { val, type } }, the reading of
// that material in an unaffected area. A point with no goal of its own uses the standard for its material.

export const MAX_MOISTURE = 300;
export const MAX_READINGS = 60;

export const MOISTURE_SURFACES = { floor: 'Floor', wall: 'Wall', ceiling: 'Ceiling' };

export const MOISTURE_TYPES = {
  mc: { label: 'Moisture content (% MC)', short: '% MC' },
  wme: { label: 'Wood moisture equivalent (% WME)', short: '% WME' },
  rel: { label: 'Relative scale (0-100)', short: ' REL' },
};

export const MOISTURE_MATERIALS = {
  drywall: 'Drywall',
  subfloor: 'Wood subfloor',
  hardwood: 'Hardwood floor',
  laminate: 'Laminate / vinyl plank',
  tile: 'Tile / backer board',
  carpet: 'Carpet',
  pad: 'Carpet pad',
  concrete: 'Concrete',
  trim: 'Baseboard / trim',
  framing: 'Framing / stud',
  plaster: 'Plaster',
  insulation: 'Insulation',
  cabinet: 'Cabinet',
  other: 'Other',
};

export const MOISTURE_COLORS = { wet: '#d9480f', dry: '#2b8a3e', unset: '#3b6ea5', none: '#868e96' };
export const STATUS_TEXT = { wet: 'Wet', dry: 'Dry', unset: 'No goal set', none: 'No reading yet' };

const COORD = 5000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).slice(0, 8);
const optional = (v, lo, hi, round) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : round(clamp(Number(v), lo, hi)));

// "12.4" -> 12.4, anything else -> NaN. Blank is NaN too, so a missing field can be told from a zero.
export function parseReading(text) {
  const t = String(text ?? '').trim();
  return /^\d+(\.\d+)?$|^\.\d+$/.test(t) ? Number(t) : NaN;
}

// One key of the on-screen number pad applied to the text being typed. Keys are the digits, '.', and 'back'.
// Up to `max` characters and `decimals` places after the point (0 = whole numbers only); a lone 0 gives way to the next digit.
export function padEdit(text, key, { max = 5, decimals = 1 } = {}) {
  const s = String(text ?? '');
  if (key === 'back') return s.slice(0, -1);
  if (key === '.') {
    if (decimals < 1 || s.includes('.')) return s;
    if (s === '') return '0.';
    return s.length >= max ? s : `${s}.`;
  }
  if (!/^\d$/.test(String(key))) return s;
  if (s.length >= max) return s;
  const dot = s.indexOf('.');
  if (dot >= 0 && s.length - dot - 1 >= decimals) return s;
  return s === '0' ? String(key) : s + key;
}

// 12.4 -> "12.4", 12 -> "12", 12.04 -> "12"
export const fmtReading = (v) => String(round1(Number(v)));

// Grains of moisture per pound of dry air, from air temperature (F) and relative humidity (%). The standard
// psychrometric calculation at sea-level pressure (Magnus formula); good to about 1 grain. Null when either is missing or out of range.
export function gpp(tempF, rh) {
  if (tempF == null || rh == null || tempF === '' || rh === '') return null;
  const t = Number(tempF);
  const r = Number(rh);
  if (!Number.isFinite(t) || !Number.isFinite(r) || r < 0 || r > 100 || t < 0 || t > 150) return null;
  const c = ((t - 32) * 5) / 9;
  const pws = 0.61094 * Math.exp((17.625 * c) / (c + 243.04)); // saturation vapour pressure, kPa
  const pw = (pws * r) / 100;
  const w = (0.62198 * pw) / (101.325 - pw);
  return round1(w * 7000);
}

// The goal a point is held to: its own, else the standard logged for its material (when read on the same scale).
export function goalFor(plan, p) {
  if (p.goal != null) return p.goal;
  const st = plan?.standards?.[p.material];
  return st && st.type === p.type ? st.val : null;
}

export function cleanStandards(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(MOISTURE_MATERIALS)) {
    const v = raw[k];
    const val = v && typeof v === 'object' ? optional(v.val, 0, 100, round1) : null;
    if (val !== null) out[k] = { val, type: MOISTURE_TYPES[v.type] ? v.type : 'mc' };
  }
  return out;
}

export function makeReading({ val, rh = null, temp = null, note = '', by = null, at = null, day = null }) {
  return {
    id: newId(),
    day: day ? String(day).slice(0, 40) : null,
    at: at || new Date().toISOString(),
    by: by && typeof by === 'object' ? { id: by.id ?? null, name: String(by.name ?? '').slice(0, 60) } : { id: null, name: '' },
    val: round1(clamp(Number(val), 0, 100)),
    rh: optional(rh, 0, 100, round1),
    temp: optional(temp, -20, 200, round1),
    note: String(note ?? '').slice(0, 80),
  };
}

export function makeMoisture(n, x, y, { surface = 'floor', material = 'drywall', type = 'mc', goal = null, h = null } = {}) {
  return {
    id: newId(), n, x: round2(x), y: round2(y),
    surface: MOISTURE_SURFACES[surface] ? surface : 'floor',
    material: MOISTURE_MATERIALS[material] ? material : 'other',
    type: MOISTURE_TYPES[type] ? type : 'mc',
    goal: optional(goal, 0, 100, round1),
    h: optional(h, 0, 30, round2),
    readings: [],
  };
}

// The next free pin number: one more than the highest in use, so a number is never reused while it is still on the sketch.
export const nextNumber = (list) => (list || []).reduce((m, p) => Math.max(m, Number(p.n) || 0), 0) + 1;

function cleanReading(r) {
  if (!r || typeof r !== 'object') return null;
  const val = optional(r.val, 0, 100, round1);
  if (val === null) return null;
  const at = Number.isFinite(Date.parse(r.at)) ? new Date(r.at).toISOString() : new Date().toISOString();
  const by = r.by && typeof r.by === 'object' ? { id: r.by.id == null ? null : String(r.by.id).slice(0, 60), name: String(r.by.name ?? '').slice(0, 60) } : { id: null, name: '' };
  return { id: '', day: r.day ? String(r.day).slice(0, 40) : null, at, by, val, rh: optional(r.rh, 0, 100, round1), temp: optional(r.temp, -20, 200, round1), note: String(r.note ?? '').slice(0, 80) };
}

// Cleans a list read from storage: bad points are dropped, numbers are limited, pin numbers are made unique.
export function cleanMoisture(list, uid) {
  const rows = (Array.isArray(list) ? list : []).slice(0, MAX_MOISTURE);
  let top = 0;
  for (const m of rows) {
    const n = Math.floor(Number(m?.n));
    if (Number.isFinite(n) && n > top && n <= 9999) top = n;
  }
  const used = new Set();
  const out = [];
  for (const m of rows) {
    if (!m || typeof m !== 'object' || !Number.isFinite(Number(m.x)) || !Number.isFinite(Number(m.y))) continue;
    let n = Math.floor(Number(m.n));
    if (!Number.isFinite(n) || n < 1 || n > 9999 || used.has(n)) { top += 1; n = top; }
    used.add(n);
    const readings = [];
    for (const r of (Array.isArray(m.readings) ? m.readings : []).slice(0, MAX_READINGS)) {
      const c = cleanReading(r);
      if (c) readings.push({ ...c, id: uid(r.id) });
    }
    out.push({
      id: uid(m.id), n,
      x: round2(clamp(Number(m.x), -COORD, COORD)), y: round2(clamp(Number(m.y), -COORD, COORD)),
      surface: MOISTURE_SURFACES[m.surface] ? m.surface : 'floor',
      material: MOISTURE_MATERIALS[m.material] ? m.material : 'other',
      type: MOISTURE_TYPES[m.type] ? m.type : 'mc',
      goal: optional(m.goal, 0, 100, round1),
      h: optional(m.h, 0, 30, round2),
      readings,
    });
  }
  return out;
}

// ------------------------------------------------------------------ reading
// Oldest first. Readings are added in order, but a device clock can be off, so go by the time and keep the entered order for ties.
export const sortedReadings = (p) => (p.readings || []).map((r, i) => [r, i]).sort((a, b) => (Date.parse(a[0].at) - Date.parse(b[0].at)) || (a[1] - b[1])).map((x) => x[0]);
export function latestReading(p) {
  const all = sortedReadings(p);
  return all.length ? all[all.length - 1] : null;
}

// Where a point stands: { state: 'none'|'unset'|'dry'|'wet', trend: 'down'|'up'|'flat'|null, latest, prev }
//   none   no reading yet          unset  a reading, but no dry goal to compare it with
//   dry    latest is at or under the goal       wet   latest is over the goal
// trend compares the latest reading with the one before it.
export function moistureStatus(p, goal = p.goal) {
  const all = sortedReadings(p);
  const latest = all.length ? all[all.length - 1] : null;
  const prev = all.length > 1 ? all[all.length - 2] : null;
  // `stale` is set when looking at a day this point has not been read on: it still has to be read, `last` is where it stood
  if (p.stale) return { state: 'none', trend: null, latest: null, prev: null, last: latest };
  let state = 'none';
  if (latest) state = goal == null ? 'unset' : latest.val <= goal ? 'dry' : 'wet';
  let trend = null;
  if (latest && prev) {
    const d = latest.val - prev.val;
    trend = Math.abs(d) < 0.05 ? 'flat' : d < 0 ? 'down' : 'up';
  }
  return { state, trend, latest, prev, last: latest };
}
export const TREND_MARK = { down: '↓', up: '↑', flat: '=' };

export const valueText = (p, r) => `${fmtReading(r.val)}${MOISTURE_TYPES[p.type].short}`;
// "48% RH · 72°F · 54 gpp", leaving out whatever was not taken
export function airText(r) {
  const g = gpp(r.temp, r.rh);
  return [r.rh != null ? `${fmtReading(r.rh)}% RH` : '', r.temp != null ? `${fmtReading(r.temp)}°F` : '', g != null ? `${Math.round(g)} gpp` : ''].filter(Boolean).join(' · ');
}

export function moistureCounts(plan) {
  const c = { points: 0, wet: 0, dry: 0, unset: 0, none: 0 };
  for (const p of plan?.moisture || []) { c.points += 1; c[moistureStatus(p, goalFor(plan, p)).state] += 1; }
  return c;
}

// The moisture point nearest a spot, within tol feet. Only points on the surface being shown, when one is chosen.
export function hitMoisture(plan, x, y, tol, filter = 'all') {
  let best = null;
  let bestD = tol;
  for (const p of plan.moisture || []) {
    if (filter !== 'all' && p.surface !== filter) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestD) { best = p; bestD = d; }
  }
  return best;
}
