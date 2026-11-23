// Payroll export (#114): hours by person for a pay period. Owner only. Pure, so the screen and the tests agree.
//
// Hours come from the clocks that already exist:
//   day clock   (shifts, minus breaks): what a person was paid to be at work
//   job clock   (job_clock_sessions): the time on jobs, travel included for restoration jobs
// For each day a person gets the day clock's net hours when they clocked a shift, otherwise their job clock hours. A person who
// only uses the job clock therefore still shows up, and nobody is counted twice. Entries that were removed never count.
// Nothing here has money in it: the owner's payroll service applies the pay rate.
import { dayKey, dayRows } from './shiftClock.js';
import { toCsv } from './csv.js';

export const PERIOD_KINDS = {
  weekly: 'Every week',
  biweekly: 'Every two weeks',
  semimonthly: 'Twice a month (1st to 15th, 16th to end)',
  monthly: 'Once a month',
};
// A Monday. Weekly and two-week periods count from this date unless the owner sets the real start of a pay period.
export const DEFAULT_ANCHOR = '2026-01-05';

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const dnum = (key) => { const [y, m, d] = String(key).split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
const keyOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export const addDays = (key, n) => keyOf(dnum(key) + n);
const lastOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1 to 12
const isKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ''));

// The pay period (both ends included) that holds a date. { start, end, days }
export function periodFor(kind, anchor, onKey) {
  const day = isKey(onKey) ? onKey : dayKey(new Date());
  if (kind === 'semimonthly' || kind === 'monthly') {
    const [y, m, d] = day.split('-').map(Number);
    const mm = String(m).padStart(2, '0');
    const last = lastOfMonth(y, m);
    let from = 1; let to = last;
    if (kind === 'semimonthly') { if (d <= 15) to = 15; else from = 16; }
    return { start: `${y}-${mm}-${String(from).padStart(2, '0')}`, end: `${y}-${mm}-${String(to).padStart(2, '0')}`, days: to - from + 1 };
  }
  const len = kind === 'biweekly' ? 14 : 7;
  const a = dnum(isKey(anchor) ? anchor : DEFAULT_ANCHOR);
  const start = a + Math.floor((dnum(day) - a) / len) * len;
  return { start: keyOf(start), end: keyOf(start + len - 1), days: len };
}

// The period before (-1) or after (+1) this one.
export function shiftPeriod(kind, anchor, period, steps) {
  return periodFor(kind, anchor, steps < 0 ? addDays(period.start, -1) : addDays(period.end, 1));
}

const fmtKey = (key, withYear) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
export const periodLabel = (p) => `${fmtKey(p.start, false)} to ${fmtKey(p.end, true)}`;

export const hoursOf = (minutes) => Math.round((num(minutes) / 60) * 100) / 100;
export const hoursText = (minutes) => hoursOf(minutes).toFixed(2);

// people: [{ id, full_name?, name?, email, role }]; shifts, breaks and sessions: rows for everyone, any period (they are filtered here).
// Returns [{ id, name, email, days: [{ date, payMinutes, dayMinutes, jobMinutes, source, notes }], payMinutes, dayMinutes, jobMinutes,
//            source, daysWorked, running, checks }], people with no time in the period left out.
export function payrollSummary({ people = [], shifts = [], breaks = [], sessions = [], period, now = new Date() }) {
  const out = [];
  for (const p of people) {
    const mine = (rows) => rows.filter((r) => r.staff_id === p.id);
    const myShifts = mine(shifts); const mySessions = mine(sessions);
    const rows = dayRows({ shifts: myShifts, breaks: mine(breaks), sessions: mySessions, role: p.role, now })
      .filter((d) => d.date >= period.start && d.date <= period.end)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const days = [];
    let running = false;
    for (const d of rows) {
      const hasShift = d.shifts.length > 0;
      const payMinutes = hasShift ? d.netMinutes : d.jobMinutes;
      if (payMinutes <= 0 && !hasShift) continue;
      const notes = [];
      if (d.shifts.some((s) => !s.shift.ended_at)) { notes.push('Still clocked in'); running = true; }
      if (d.shifts.some((s) => s.shift.edited_at)) notes.push('Changed after the fact');
      // On a day with no shift the job clock IS the pay record, so "job time with no shift" is expected there, not a problem.
      for (const f of d.flags) if (f.level === 'warn' && !(!hasShift && f.key === 'job_outside_shift')) notes.push(f.text);
      days.push({ date: d.date, payMinutes, dayMinutes: d.netMinutes, jobMinutes: d.jobMinutes, source: hasShift ? 'day clock' : 'job clock', notes });
    }
    if (!days.length) continue;
    // A job clock running with no end also means the person may still be working.
    if (mySessions.some((s) => !s.ended_at && !s.voided_at)) running = true;
    const sources = new Set(days.map((d) => d.source));
    out.push({
      id: p.id, name: p.name || p.full_name || p.email || 'Someone', email: p.email || '',
      days,
      payMinutes: days.reduce((n, d) => n + d.payMinutes, 0),
      dayMinutes: days.reduce((n, d) => n + d.dayMinutes, 0),
      jobMinutes: days.reduce((n, d) => n + d.jobMinutes, 0),
      source: sources.size > 1 ? 'mixed' : [...sources][0],
      daysWorked: days.length,
      running,
      checks: days.reduce((n, d) => n + d.notes.length, 0),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// One line per person for the pay period.
export function payrollSummaryCsv(summary, period) {
  const rows = [['Employee', 'Email', 'Pay period start', 'Pay period end', 'Total hours', 'Day clock hours', 'Job clock hours', 'Days worked', 'Hours from', 'Needs a check']];
  for (const p of summary) {
    rows.push([p.name, p.email, period.start, period.end, hoursText(p.payMinutes), hoursText(p.dayMinutes), hoursText(p.jobMinutes), p.daysWorked, p.source, p.running || p.checks > 0 ? 'Yes' : '']);
  }
  return toCsv(rows);
}

// One line per person per day, for checking the totals.
export function payrollDetailCsv(summary, period) {
  const rows = [['Employee', 'Date', 'Hours', 'Hours from', 'Day clock hours', 'Job clock hours', 'Notes']];
  for (const p of summary) {
    for (const d of p.days) rows.push([p.name, d.date, hoursText(d.payMinutes), d.source, hoursText(d.dayMinutes), hoursText(d.jobMinutes), d.notes.join(' | ')]);
  }
  return toCsv(rows);
}

export const payrollFileName = (period, kind = 'summary') => `payroll-${kind}-${period.start}-to-${period.end}.csv`;
