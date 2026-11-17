// Open appointment times for booking. Pure, so the server, the screens and the tests agree.
//
// A slot is a fixed-length appointment (default 2 hours) with a gap after it (default 1 hour) before the next one can start,
// so with a 8:00 to 5:00 day the slots are 8-10, 11-1 and 2-4. A slot is open when fewer than `crews` visits overlap it
// (counting the gap on both sides). Every active visit counts, whoever booked it and whether or not a tech is assigned.
// All the clock times are in the business time zone (Settings > Business), never the viewer's.

export const DEFAULT_BOOKING = {
  booking_enabled: true,
  booking_after_sign: true,
  booking_days: [1, 2, 3, 4, 5], // 1 = Monday ... 7 = Sunday
  booking_day_start: '08:00',
  booking_day_end: '17:00',
  booking_slot_minutes: 120,
  booking_gap_minutes: 60,
  booking_crews: 1,
  booking_notice_hours: 24,
  booking_window_days: 30,
};

// The kinds of job a salesperson can book in person. The public page only ever books carpet.
export const BOOKING_KINDS = ['carpet', 'extraction', 'mitigation', 'remediation'];
export const BOOKING_KIND_LABELS = { carpet: 'Carpet', extraction: 'Extraction', mitigation: 'Mitigation', remediation: 'Remediation' };

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DEFAULT_TZ = 'America/Chicago';
export const ACTIVE_VISIT = ['scheduled', 'on_the_way', 'started'];

// ------------------------------------------------------------------ time zone helpers
const formatters = new Map();
function dtf(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function tzParts(ms, tz = DEFAULT_TZ) {
  const out = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return { y: out.year, m: out.month, d: out.day, h: out.hour % 24, mi: out.minute, s: out.second };
}

// How far ahead of UTC the zone is at that moment, in ms (Central is -5h or -6h).
export function tzOffsetMs(ms, tz = DEFAULT_TZ) {
  const p = tzParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

// The moment a wall-clock time happens in the zone.
export function zonedToUtcMs(y, m, d, h, mi, tz = DEFAULT_TZ) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - tzOffsetMs(guess, tz);
  const again = guess - tzOffsetMs(t, tz);
  if (again !== t) t = again; // the clocks changed between the guess and the answer
  return t;
}

const pad = (n) => String(n).padStart(2, '0');
export function localDateStr(ms, tz = DEFAULT_TZ) {
  const p = tzParts(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
export function addDaysStr(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// 1 = Monday ... 7 = Sunday
export function isoDow(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function parseHm(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s ?? ''));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
export const fmtHm = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// ------------------------------------------------------------------ settings
const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

// What the settings row (or the form) means, with every value kept inside its limits.
export function normalizeBooking(raw = {}) {
  const d = DEFAULT_BOOKING;
  const days = [...new Set((Array.isArray(raw.booking_days) ? raw.booking_days : d.booking_days).map(Number))]
    .filter((x) => Number.isInteger(x) && x >= 1 && x <= 7)
    .sort((a, b) => a - b);
  const startMin = parseHm(raw.booking_day_start) ?? parseHm(d.booking_day_start);
  const endMin = parseHm(raw.booking_day_end) ?? parseHm(d.booking_day_end);
  const slot = clampInt(raw.booking_slot_minutes, 30, 480, d.booking_slot_minutes);
  const gap = clampInt(raw.booking_gap_minutes, 0, 240, d.booking_gap_minutes);
  const starts = [];
  for (let t = startMin; endMin > startMin && t + slot <= endMin; t += slot + gap) starts.push(t);
  return {
    enabled: raw.booking_enabled !== false,
    afterSign: raw.booking_after_sign !== false,
    days: days.length ? days : d.booking_days,
    startMin,
    endMin,
    slot,
    gap,
    crews: clampInt(raw.booking_crews, 1, 50, d.booking_crews),
    notice: clampInt(raw.booking_notice_hours, 0, 720, d.booking_notice_hours),
    windowDays: clampInt(raw.booking_window_days, 1, 90, d.booking_window_days),
    starts,
    tz: raw.timezone || DEFAULT_TZ,
  };
}

// The Settings form: returns { error } or { value } ready to save.
export function validateBookingSettings(form) {
  const days = [...new Set((form.booking_days || []).map(Number))].filter((x) => x >= 1 && x <= 7).sort((a, b) => a - b);
  if (!days.length) return { error: 'Pick at least one day of the week.' };
  const start = parseHm(form.booking_day_start);
  const end = parseHm(form.booking_day_end);
  if (start === null || end === null) return { error: 'Enter the first start time and the last end time.' };
  if (end <= start) return { error: 'The last end time has to be after the first start time.' };
  const num = (v, lo, hi, label) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= lo && n <= hi ? null : `${label} must be a whole number from ${lo} to ${hi}.`;
  };
  const problem = num(form.booking_slot_minutes, 30, 480, 'Appointment length (minutes)')
    || num(form.booking_gap_minutes, 0, 240, 'Gap between appointments (minutes)')
    || num(form.booking_crews, 1, 50, 'Jobs at the same time')
    || num(form.booking_notice_hours, 0, 720, 'Minimum notice (hours)')
    || num(form.booking_window_days, 1, 90, 'How far ahead (days)');
  if (problem) return { error: problem };
  const slot = Number(form.booking_slot_minutes);
  if (start + slot > end) return { error: 'The day is too short to fit even one appointment. Widen the hours or shorten the appointment.' };
  return {
    value: {
      booking_enabled: !!form.booking_enabled,
      booking_after_sign: !!form.booking_after_sign,
      booking_days: days,
      booking_day_start: fmtHm(start),
      booking_day_end: fmtHm(end),
      booking_slot_minutes: slot,
      booking_gap_minutes: Number(form.booking_gap_minutes),
      booking_crews: Number(form.booking_crews),
      booking_notice_hours: Number(form.booking_notice_hours),
      booking_window_days: Number(form.booking_window_days),
    },
  };
}

// ------------------------------------------------------------------ open slots
const ms = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

// How many visits stop a slot from being used: any visit that overlaps it or sits inside the gap on either side.
export function blockingCount(busy, slotStartMs, slotEndMs, gapMs) {
  let n = 0;
  for (const [s, e] of busy) if (s < slotEndMs + gapMs && e + gapMs > slotStartMs) n += 1;
  return n;
}

// settings: the settings row. busy: active visits [{ starts_at, ends_at }]. Returns { tz, days: [{ date, slots: [{ start, end }] }] }
// with only the days that still have an open slot. Times are ISO strings.
export function computeOpenSlots({ now = new Date(), settings = {}, busy = [] } = {}) {
  const cfg = normalizeBooking(settings);
  const nowMs = ms(now);
  const earliest = nowMs + cfg.notice * 3600000;
  const len = cfg.slot * 60000;
  const gap = cfg.gap * 60000;
  const spans = busy.map((v) => [ms(v.starts_at), ms(v.ends_at)]).filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e));
  const today = localDateStr(nowMs, cfg.tz);
  const days = [];
  for (let i = 0; i <= cfg.windowDays; i += 1) {
    const date = addDaysStr(today, i);
    if (!cfg.days.includes(isoDow(date))) continue;
    const [y, m, d] = date.split('-').map(Number);
    const slots = [];
    for (const t of cfg.starts) {
      const start = zonedToUtcMs(y, m, d, Math.floor(t / 60), t % 60, cfg.tz);
      if (start < earliest) continue;
      if (blockingCount(spans, start, start + len, gap) >= cfg.crews) continue;
      slots.push({ start: new Date(start).toISOString(), end: new Date(start + len).toISOString() });
    }
    if (slots.length) days.push({ date, slots });
  }
  return { tz: cfg.tz, days };
}

// The open slot that starts at this moment, or null. Used to check what a customer picked, since the list
// may have changed since they loaded the page.
export function findSlot(days, startIso) {
  const want = ms(startIso);
  if (!Number.isFinite(want)) return null;
  for (const day of days || []) for (const s of day.slots) if (ms(s.start) === want) return s;
  return null;
}

export const countSlots = (days) => (days || []).reduce((n, d) => n + d.slots.length, 0);

// ------------------------------------------------------------------ wording
export function fmtSlotDay(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function fmtSlotDayShort(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function fmtSlotTime(iso, tz = DEFAULT_TZ) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
}
export const fmtSlotRange = (startIso, endIso, tz = DEFAULT_TZ) => `${fmtSlotTime(startIso, tz)} to ${fmtSlotTime(endIso, tz)}`;
// "Tue, Nov 24, 8:00 AM to 10:00 AM"
export function fmtSlotFull(startIso, endIso, tz = DEFAULT_TZ) {
  const day = new Date(startIso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
  return `${day}, ${fmtSlotRange(startIso, endIso, tz)}`;
}
