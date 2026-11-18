// The job clock. Pure rules so the server, the screens and the tests agree. No money in here: a tech can see their own clock,
// and the owner's costing (lib/jobCost.js) turns finished sessions into hours at the person's cost rate.
//
// One session = one stretch of time one person had the clock running on one job.
//   * Restoration jobs (extraction, mitigation, remediation): the clock starts when the tech taps "On the way", so travel
//     counts as job hours, and keeps running through "Start job".
//   * Carpet jobs, and jobs with no service: the clock starts at "Start job".
//   * "Finish job" stops it. A tech can also clock out and back in (lunch): that is simply a second session.
import { effectiveLines, choiceFromEstimate } from './estimateOptions.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ms = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };

export const RESTORATION_SERVICES = ['extraction', 'mitigation', 'remediation'];
export const startsAtOnTheWay = (service) => RESTORATION_SERVICES.includes(service);

// What a visit button does to the clock. `open` is the person's still-running session on this job, if any.
// Returns 'open' (start a session), 'arrive' (keep the running session, note the arrival), 'close' or null (do nothing).
export function clockStepFor({ service, action, open }) {
  if (action === 'on_the_way') return startsAtOnTheWay(service) && !open ? 'open' : null;
  if (action === 'started') return open ? 'arrive' : 'open';
  if (action === 'finished') return open ? 'close' : null;
  return null;
}

export const sessionMinutes = (s, now = new Date()) => {
  const a = ms(s?.started_at);
  if (a === null) return 0;
  const b = s?.ended_at ? ms(s.ended_at) : now.getTime();
  return Math.max(0, Math.round(((b ?? a) - a) / MIN));
};

// Hours for the costing ledger: two decimals. A session shorter than half a minute is 0 (no ledger entry is made for it).
// Longer than 24 hours is capped at 24, the ledger's limit; the owner fixes a forgotten clock with an edit.
export function sessionHours(s) {
  const a = ms(s?.started_at); const b = ms(s?.ended_at);
  if (a === null || b === null || b <= a) return 0;
  return Math.min(24, Math.round(((b - a) / HOUR) * 100) / 100);
}

export const totalMinutes = (sessions, now = new Date()) => (sessions || []).filter((s) => !s.voided_at).reduce((n, s) => n + sessionMinutes(s, now), 0);

// "2:05" for 125 minutes, "0:07" for 7. Used on the running chip and in lists.
export function clockText(minutes) {
  const m = Math.max(0, Math.round(num(minutes)));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
// "2 h 05 min" for sentences
export function durationText(minutes) {
  const m = Math.max(0, Math.round(num(minutes)));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

// ------------------------------------------------------------------------------------------------------ edit requests
export const EDIT_STATUS = { pending: 'Waiting for the owner', approved: 'Approved', rejected: 'Not approved' };
const MAX_SHIFT_MS = 48 * HOUR; // an edit may not move either end more than two days from what was recorded

// A tech asks to change the start and/or end of a finished session. Returns { error } or { value: { started_at, ended_at, reason } }.
// Nothing changes until the owner approves.
export function validateEdit({ session, started_at, ended_at, reason }, now = new Date()) {
  if (!session) return { error: 'That time entry was not found.' };
  if (!session.ended_at) return { error: 'The clock is still running on that entry. Clock out first, then ask for the change.' };
  if (session.voided_at) return { error: 'That time entry was removed.' };
  const s = ms(started_at); const e = ms(ended_at);
  if (s === null || e === null) return { error: 'Enter both a start and an end time.' };
  if (e <= s) return { error: 'The end time has to be after the start time.' };
  if (e - s > 24 * HOUR) return { error: 'One entry can be at most 24 hours. Split it into two.' };
  if (e > now.getTime() + 5 * MIN) return { error: 'The end time cannot be in the future.' };
  const os = ms(session.started_at); const oe = ms(session.ended_at);
  if (Math.abs(s - os) > MAX_SHIFT_MS || Math.abs(e - oe) > MAX_SHIFT_MS) return { error: 'That is more than two days away from what was recorded. Ask the office to fix it directly.' };
  if (s === os && e === oe) return { error: 'Those are the same times that are already recorded.' };
  const why = String(reason || '').trim();
  if (why.length < 3) return { error: 'Say why the time needs to change.' };
  return { value: { started_at: new Date(s).toISOString(), ended_at: new Date(e).toISOString(), reason: why.slice(0, 300) } };
}

// ------------------------------------------------------------------------------------------------------ allotted time
// Minutes a job is allowed, worked out from the lines the customer is paying for (included lines, the tier they chose, the
// add-ons they ticked) and the minutes-per-unit set on each price list item. A line in hours counts 60 minutes an hour with no
// rate needed. Lines whose price list item has no time rate, and custom lines, are counted in `unrated` and add nothing.
//   estimate: { status, chosen_tier, lines: [{ id, price_item_id, unit, quantity, tier, optional, accepted }] }
//   items: { [price_item_id]: minutes_per_unit | null }
export function allottedMinutes(estimate, items = {}) {
  const lines = estimate?.lines || [];
  const approved = estimate?.status === 'approved';
  const choice = approved ? choiceFromEstimate(estimate, lines) : { tier: null, picks: [] };
  let minutes = 0; let unrated = 0; let rated = 0;
  for (const l of effectiveLines(lines, choice)) {
    const qty = num(l.quantity);
    if (qty <= 0 || num(l.unit_price) < 0) continue; // discounts and empty lines carry no time
    if (l.unit === 'hour') { minutes += qty * 60; rated += 1; continue; }
    const rate = l.price_item_id ? items[l.price_item_id] : null;
    if (rate == null || !(num(rate) > 0)) { unrated += 1; continue; }
    minutes += qty * num(rate); rated += 1;
  }
  return { minutes: Math.round(minutes), unrated, rated, any: rated > 0 };
}

// ------------------------------------------------------------------------------------------------------ efficiency
// Dollars per clocked hour, and how the clock compares with the allotted time.
//   revenueCents: what the job brings in (jobRevenue in lib/jobCost.js). clockedMinutes / allottedMinutes: whole minutes.
export function efficiency({ revenueCents, clockedMinutes, allottedMinutes: allotted }) {
  const clocked = Math.max(0, num(clockedMinutes));
  const rev = revenueCents == null ? null : num(revenueCents);
  const perHourCents = rev != null && clocked > 0 ? Math.round(rev / (clocked / 60)) : null;
  const a = num(allotted);
  const usedPct = a > 0 && clocked > 0 ? Math.round((clocked / a) * 100) : null; // 100 = right on the allotted time
  const diff = a > 0 && clocked > 0 ? Math.round(clocked - a) : null;            // minutes over (+) or under (-)
  return { perHourCents, usedPct, diffMinutes: diff, over: diff != null && diff > 0 };
}

// The owner's roll-up. rows: [{ jobId, revenueCents, allottedMinutes, byStaff: { [staffId]: minutes } }] for carpet jobs that
// finished in the window. A job's revenue is shared out between the people who worked it, by their share of the minutes.
// Returns { jobs, clockedMinutes, revenueCents, perHourCents, allottedMinutes, usedPct, byStaff: [{ staffId, minutes, revenueCents, perHourCents, jobs }] }.
// Jobs with no clocked time or no revenue are left out of the dollars (nothing to divide) but counted in `skipped`.
export function efficiencyRollup(rows) {
  const staff = new Map();
  let clocked = 0; let revenue = 0; let allotted = 0; let jobs = 0; let skipped = 0; let withAllotted = 0; let clockedWithAllotted = 0;
  for (const r of rows || []) {
    const per = Object.entries(r.byStaff || {}).map(([id, m]) => [id, Math.max(0, num(m))]);
    const mins = per.reduce((s, [, m]) => s + m, 0);
    if (!(mins > 0) || r.revenueCents == null) { skipped += 1; continue; }
    jobs += 1; clocked += mins; revenue += num(r.revenueCents);
    if (num(r.allottedMinutes) > 0) { allotted += num(r.allottedMinutes); withAllotted += 1; clockedWithAllotted += mins; }
    for (const [id, m] of per) {
      const cur = staff.get(id) || { staffId: id, minutes: 0, revenueCents: 0, jobs: 0 };
      cur.minutes += m; cur.revenueCents += num(r.revenueCents) * (m / mins); cur.jobs += 1;
      staff.set(id, cur);
    }
  }
  const byStaff = [...staff.values()].map((s) => ({ ...s, revenueCents: Math.round(s.revenueCents), perHourCents: s.minutes > 0 ? Math.round(s.revenueCents / (s.minutes / 60)) : null }))
    .sort((a, b) => (b.perHourCents || 0) - (a.perHourCents || 0));
  return {
    jobs, skipped, clockedMinutes: clocked, revenueCents: Math.round(revenue),
    perHourCents: clocked > 0 ? Math.round(revenue / (clocked / 60)) : null,
    allottedMinutes: Math.round(allotted), jobsWithAllotted: withAllotted,
    usedPct: allotted > 0 ? Math.round((clockedWithAllotted / allotted) * 100) : null,
    byStaff,
  };
}
