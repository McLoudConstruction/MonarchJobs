// The day clock: when each person was on the clock for the day (a shift), and their breaks inside it. Pure rules, shared by the
// tech's Clock card, the owner's Time clock tab, the server and the tests. No money in here.
//
// Not to be confused with the job clock (lib/jobClock.js), which times work on one job. The two are compared to flag things that do
// not add up: job time with no shift, more job time than shift time, a clock left running overnight.
export const TZ = 'America/Chicago';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ms = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ------------------------------------------------------------------------------------------------------ dates
// "2026-11-17" for a moment, in the shop's time zone. A shift belongs to the day it started.
export function dayKey(v, tz = TZ) {
  const t = ms(v);
  if (t === null) return '';
  return new Date(t).toLocaleDateString('en-CA', { timeZone: tz });
}
const parts = (key) => { const [y, m, d] = key.split('-').map(Number); return { y, m, d }; };
export function addDaysKey(key, n) {
  const { y, m, d } = parts(key);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
// Monday of the week a day key falls in.
export function weekStartKey(key) {
  const { y, m, d } = parts(key);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDaysKey(key, -((dow + 6) % 7));
}
export const weekKeys = (startKey) => Array.from({ length: 7 }, (_, i) => addDaysKey(startKey, i));
// The instant a local day begins (midnight in the shop's zone). Works across daylight saving changes.
export function dayStartInstant(key, tz = TZ) {
  const guess = new Date(`${key}T00:00:00Z`).getTime();
  for (const off of [6, 5, 7, 4, 8, 0]) { // hours behind UTC to try; Central is 5 or 6
    const t = guess + off * HOUR;
    if (new Date(t).toLocaleDateString('en-CA', { timeZone: tz }) === key && new Date(t - 1).toLocaleDateString('en-CA', { timeZone: tz }) !== key) return new Date(t);
  }
  return new Date(guess + 6 * HOUR);
}

// ------------------------------------------------------------------------------------------------------ minutes
export const spanMinutes = (startedAt, endedAt, now = new Date()) => {
  const a = ms(startedAt); if (a === null) return 0;
  const b = endedAt ? ms(endedAt) : now.getTime();
  return Math.max(0, Math.round(((b ?? a) - a) / MIN));
};
const live = (rows) => (rows || []).filter((r) => !r.voided_at);
// A shift shorter than this is a mis-tap, not a day's work: clocking out inside it throws the record away (see shiftAction).
export const MIN_SHIFT_MINUTES = 5;
export function shiftTooShort(startedAt, endedAt) {
  const a = ms(startedAt); const b = ms(endedAt);
  if (a === null || b === null) return false;
  return b - a < MIN_SHIFT_MINUTES * MIN;
}


// One shift with its breaks: gross minutes, minutes on break, and the minutes actually worked.
export function shiftTotals(shift, breaks, now = new Date()) {
  const gross = spanMinutes(shift.started_at, shift.ended_at, now);
  const brk = live(breaks).filter((b) => b.shift_id === shift.id).reduce((n, b) => n + spanMinutes(b.started_at, b.ended_at, now), 0);
  return { gross, breakMinutes: Math.min(brk, gross), net: Math.max(0, gross - brk) };
}

// The overlap, in minutes, between two spans (an open end counts as `now`).
function overlap(aS, aE, bS, bE, now) {
  const a0 = ms(aS); const a1 = aE ? ms(aE) : now.getTime(); const b0 = ms(bS); const b1 = bE ? ms(bE) : now.getTime();
  if ([a0, a1, b0, b1].some((x) => x === null)) return 0;
  return Math.max(0, Math.round((Math.min(a1, b1) - Math.max(a0, b0)) / MIN));
}

// "2:05" for 125 minutes; "8 h 05 min" in sentences.
export function hmText(minutes) { const m = Math.max(0, Math.round(num(minutes))); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }
export function hmWords(minutes) {
  const m = Math.max(0, Math.round(num(minutes)));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
export const hoursText = (minutes) => (Math.round((num(minutes) / 60) * 100) / 100).toFixed(2);

// ------------------------------------------------------------------------------------------------------ flags
// Things that do not add up, worked out from one person's rows. Each flag: { key, level: 'warn' | 'info', date, shiftId?, text }.
// `warn` is something the owner should look at; `info` is worth knowing and often fine (no break on a short shift).
//   shifts, breaks: from shifts / shift_breaks.  sessions: the person's job_clock_sessions.  role: 'tech' | 'office' | 'owner'.
export const LIMITS = {
  stillOpenHours: 14,     // clocked in this long with no clock out
  longShiftHours: 12,     // a finished shift longer than this
  noBreakAfterHours: 6,   // a shift this long with no break at all
  longBreakMinutes: 90,
  jobOutsideShiftMinutes: 10,
  jobInBreakMinutes: 10,
  jobOverShiftMinutes: 15,
  idleShiftMinutes: 120,  // a tech's shift this long with no job time at all
};

export function shiftFlags({ shifts, breaks, sessions, role = 'tech', now = new Date() }) {
  const out = [];
  const S = live(shifts).sort((a, b) => ms(a.started_at) - ms(b.started_at));
  const B = live(breaks);
  const J = live(sessions);
  const today = dayKey(now);
  const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' });

  S.forEach((s, i) => {
    const date = dayKey(s.started_at);
    const t = shiftTotals(s, B, now);
    if (!s.ended_at) {
      if (date !== today || t.gross > LIMITS.stillOpenHours * 60) out.push({ key: 'still_open', level: 'warn', date, shiftId: s.id, text: `Still clocked in since ${when(s.started_at)}. Probably forgot to clock out.` });
    } else {
      if (t.net > LIMITS.longShiftHours * 60) out.push({ key: 'long_shift', level: 'warn', date, shiftId: s.id, text: `Long shift: ${hmWords(t.net)} worked.` });
      if (t.gross > LIMITS.noBreakAfterHours * 60 && !B.some((b) => b.shift_id === s.id)) out.push({ key: 'no_break', level: 'info', date, shiftId: s.id, text: `No break recorded on a ${hmWords(t.gross)} shift.` });
    }
    for (const b of B.filter((x) => x.shift_id === s.id)) {
      const bm = spanMinutes(b.started_at, b.ended_at, now);
      if (b.ended_at && bm > LIMITS.longBreakMinutes) out.push({ key: 'long_break', level: 'info', date, shiftId: s.id, text: `Long break: ${hmWords(bm)}.` });
      if (!b.ended_at && s.ended_at) out.push({ key: 'break_open', level: 'warn', date, shiftId: s.id, text: 'A break was never ended.' });
    }
    // two shifts at once
    for (let j = i + 1; j < S.length; j += 1) {
      const o = overlap(s.started_at, s.ended_at, S[j].started_at, S[j].ended_at, now);
      if (o > 0) out.push({ key: 'overlap', level: 'warn', date, shiftId: s.id, text: `Overlaps another shift by ${hmWords(o)}.` });
    }
  });

  // job time against the shift it should sit inside
  for (const j of J) {
    const date = dayKey(j.started_at);
    const jm = spanMinutes(j.started_at, j.ended_at, now);
    if (jm <= 0) continue;
    const covered = S.reduce((n, s) => n + overlap(j.started_at, j.ended_at, s.started_at, s.ended_at, now), 0);
    const outside = jm - Math.min(jm, covered);
    if (outside > LIMITS.jobOutsideShiftMinutes) out.push({ key: 'job_outside_shift', level: 'warn', date, text: `${hmWords(outside)} of job time with no shift clocked in.` });
    const inBreak = B.reduce((n, b) => n + overlap(j.started_at, j.ended_at, b.started_at, b.ended_at, now), 0);
    if (inBreak > LIMITS.jobInBreakMinutes) out.push({ key: 'job_in_break', level: 'info', date, text: `The job clock ran ${hmWords(inBreak)} during a break.` });
  }
  // a day's job time against that day's shift time
  const days = new Map();
  for (const s of S) { const d = dayKey(s.started_at); const c = days.get(d) || { net: 0, job: 0, n: 0 }; c.net += shiftTotals(s, B, now).net; c.n += 1; days.set(d, c); }
  for (const j of J) { const c = days.get(dayKey(j.started_at)); if (c) c.job += spanMinutes(j.started_at, j.ended_at, now); }
  for (const [date, c] of days) {
    if (c.job > c.net + LIMITS.jobOverShiftMinutes && !out.some((f) => f.date === date && f.key === 'job_outside_shift')) {
      out.push({ key: 'job_over_shift', level: 'warn', date, text: `${hmWords(c.job)} on jobs but only ${hmWords(c.net)} on the clock.` });
    }
    if (role === 'tech' && c.net >= LIMITS.idleShiftMinutes && c.job === 0 && date !== today) {
      out.push({ key: 'no_job_time', level: 'info', date, text: `${hmWords(c.net)} on the clock with no time on any job.` });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.level === b.level ? 0 : a.level === 'warn' ? -1 : 1)));
}

// A person's rows grouped by day, newest first: [{ date, shifts: [{ shift, breaks, ...totals }], netMinutes, jobMinutes, flags }].
export function dayRows({ shifts, breaks, sessions, role = 'tech', now = new Date() }) {
  const flags = shiftFlags({ shifts, breaks, sessions, role, now });
  const map = new Map();
  const get = (d) => { if (!map.has(d)) map.set(d, { date: d, shifts: [], netMinutes: 0, grossMinutes: 0, breakMinutes: 0, jobMinutes: 0, flags: [] }); return map.get(d); };
  for (const s of live(shifts).sort((a, b) => ms(a.started_at) - ms(b.started_at))) {
    const row = get(dayKey(s.started_at));
    const t = shiftTotals(s, breaks, now);
    row.shifts.push({ shift: s, breaks: live(breaks).filter((b) => b.shift_id === s.id).sort((a, b) => ms(a.started_at) - ms(b.started_at)), ...t });
    row.netMinutes += t.net; row.grossMinutes += t.gross; row.breakMinutes += t.breakMinutes;
  }
  for (const j of live(sessions)) get(dayKey(j.started_at)).jobMinutes += spanMinutes(j.started_at, j.ended_at, now);
  for (const f of flags) get(f.date).flags.push(f);
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ------------------------------------------------------------------------------------------------------ revision requests
// A person asks to change a shift or a break, or to add a shift they never clocked. Nothing changes until the owner approves.
// target 'shift': { shift, breaks }.  'break': { shift, brk }.  'add': { others: the person's other shifts }.
// Returns { error } or { value: { started_at, ended_at, reason } }.
export function validateShiftEdit({ target, shift, brk, breaks = [], others = [], started_at, ended_at, reason }, now = new Date()) {
  const s = ms(started_at); const e = ms(ended_at);
  if (s === null || e === null) return { error: 'Enter both a start and an end time.' };
  if (e <= s) return { error: 'The end time has to be after the start time.' };
  if (e > now.getTime() + 5 * MIN) return { error: 'The end time cannot be in the future.' };
  const why = String(reason || '').trim();
  if (why.length < 3) return { error: 'Say why this needs to change.' };
  const limit = target === 'break' ? 12 * HOUR : 24 * HOUR;
  if (e - s > limit) return { error: target === 'break' ? 'A break can be at most 12 hours.' : 'One shift can be at most 24 hours. Split it into two.' };

  if (target === 'shift') {
    if (!shift || shift.voided_at) return { error: 'That shift was not found.' };
    if (!shift.ended_at) return { error: 'You are still clocked in on that shift. Clock out first, then ask for the change.' };
    if (s === ms(shift.started_at) && e === ms(shift.ended_at)) return { error: 'Those are the same times that are already recorded.' };
    if (Math.abs(s - ms(shift.started_at)) > 48 * HOUR || Math.abs(e - ms(shift.ended_at)) > 48 * HOUR) return { error: 'That is more than two days away from what was recorded. Ask the owner to fix it directly.' };
    const stray = live(breaks).filter((b) => b.shift_id === shift.id && (ms(b.started_at) < s || (b.ended_at && ms(b.ended_at) > e)));
    if (stray.length) return { error: 'A break falls outside those times. Change the break too, or pick times that still include it.' };
    const clash = live(others).find((o) => o.id !== shift.id && overlap(new Date(s).toISOString(), new Date(e).toISOString(), o.started_at, o.ended_at, now) > 0);
    if (clash) return { error: 'Those times overlap another shift.' };
  } else if (target === 'break') {
    if (!brk || brk.voided_at) return { error: 'That break was not found.' };
    if (!brk.ended_at) return { error: 'That break is still going. End it first.' };
    if (!shift) return { error: 'That shift was not found.' };
    if (s === ms(brk.started_at) && e === ms(brk.ended_at)) return { error: 'Those are the same times that are already recorded.' };
    if (s < ms(shift.started_at) || (shift.ended_at && e > ms(shift.ended_at))) return { error: 'A break has to be inside its shift.' };
    const clash = live(breaks).find((b) => b.id !== brk.id && b.shift_id === shift.id && overlap(new Date(s).toISOString(), new Date(e).toISOString(), b.started_at, b.ended_at, now) > 0);
    if (clash) return { error: 'Those times overlap another break.' };
  } else if (target === 'add') {
    if (s < now.getTime() - 14 * 24 * HOUR) return { error: 'You can ask to add a shift from the last 14 days. Older ones need the owner.' };
    const clash = live(others).find((o) => overlap(new Date(s).toISOString(), new Date(e).toISOString(), o.started_at, o.ended_at, now) > 0);
    if (clash) return { error: 'Those times overlap a shift you already have.' };
  } else {
    return { error: 'Unknown kind of change.' };
  }
  return { value: { started_at: new Date(s).toISOString(), ended_at: new Date(e).toISOString(), reason: why.slice(0, 300) } };
}

export const REQUEST_WHAT = { shift: 'a shift', break: 'a break', add: 'a missed shift' };

// ------------------------------------------------------------------------------------------------------ export
const csvCell = (v) => {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // a cell that starts with = + - @ would run as a formula in a spreadsheet
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
// One line per shift for a payroll spreadsheet. people: [{ id, name, days: dayRows(...) }]. Times in the shop's time zone.
export function shiftsCsv(people, now = new Date()) {
  const header = ['Employee', 'Date', 'Clock in', 'Clock out', 'Break minutes', 'Hours worked', 'Job clock hours that day', 'Notes'];
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '');
  const lines = [header.map(csvCell).join(',')];
  for (const p of people) {
    for (const day of [...p.days].reverse()) {
      day.shifts.forEach((x, i) => {
        const notes = [];
        if (!x.shift.ended_at) notes.push('Still clocked in');
        if (x.shift.edited_at) notes.push('Changed after the fact');
        if (i === 0) notes.push(...day.flags.filter((f) => f.level === 'warn').map((f) => f.text));
        lines.push([p.name, day.date, time(x.shift.started_at), time(x.shift.ended_at), x.breakMinutes, hoursText(x.net), i === 0 ? hoursText(day.jobMinutes) : '', notes.join(' | ')].map(csvCell).join(','));
      });
    }
  }
  return lines.join('\n');
}
