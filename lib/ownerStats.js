// Numbers for the owner dashboard, worked out from rows already read from the database. Pure (no database, no clock of its
// own: `now` is passed in), so the tests can check every figure.
//
// "Booked" money is an estimate the customer approved, counted on the day they approved it, at what they chose (their tier
// and add-ons). "Collected" and "owed" come from invoices and payments (invoiceStats below). Profit needs job costing,
// which does not exist yet, so nothing here claims it.
import { currentTotals, tierTotals, hasTiers } from './estimateOptions.js';
import { serviceOf } from './services.js';
import { agingTotals, isPastDue, daysBetween, todayIn, AGING } from './invoice.js';

export const RANGES = [
  ['month', 'This month'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
  ['year', 'This year'],
  ['all', 'All time'],
];

const DAY = 24 * 60 * 60 * 1000;
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

// The window for a range key, and the window of the same length just before it (for "up / down from before").
// `from` is null for all time (no earlier window then). `to` is `now`.
export function rangeBounds(key, now = new Date()) {
  let from = null;
  if (key === 'month') from = startOfMonth(now);
  else if (key === '30d') from = new Date(now.getTime() - 30 * DAY);
  else if (key === '90d') from = new Date(now.getTime() - 90 * DAY);
  else if (key === 'year') from = new Date(now.getFullYear(), 0, 1);
  if (!from) return { key: 'all', from: null, to: now, prevFrom: null, prevTo: null };
  if (key === 'month') return { key, from, to: now, prevFrom: new Date(now.getFullYear(), now.getMonth() - 1, 1), prevTo: from };
  if (key === 'year') return { key, from, to: now, prevFrom: new Date(now.getFullYear() - 1, 0, 1), prevTo: from };
  const span = now.getTime() - from.getTime();
  return { key, from, to: now, prevFrom: new Date(from.getTime() - span), prevTo: from };
}

const at = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };
export function inWindow(iso, from, to) {
  const t = at(iso);
  if (t === null) return false;
  if (from && t < from.getTime()) return false;
  if (to && t >= to.getTime()) return false;
  return true;
}
const inRange = (iso, r) => inWindow(iso, r.from, r.to);

// "2026-03" for a date, in the viewer's own time zone
export const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};
// The last n month keys ending with the month of `now`, oldest first
export function lastMonths(n, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  return out;
}

// What an estimate is worth, in cents. Approved: what the customer chose. Not yet approved: the included lines, plus the
// lowest tier when there are tiers (the least the customer could pick), never the add-ons.
export function estimateCents(est) {
  const lines = est?.lines || [];
  if (est?.status === 'approved') return currentTotals(est, lines).totalCents;
  if (hasTiers(lines)) {
    const totals = Object.values(tierTotals(lines, est?.minimum_charge)).map((t) => t.totalCents);
    return totals.length ? Math.min(...totals) : 0;
  }
  return currentTotals(est, lines).totalCents;
}

// The kind of work an estimate is for, from its job or (before booking) its lead
export const estimateService = (est) => serviceOf(est?.job) || serviceOf(est?.lead) || 'other';

export const SERVICE_ORDER = ['carpet', 'extraction', 'mitigation', 'remediation', 'other'];
export const SERVICE_NAMES = { carpet: 'Carpet', extraction: 'Extraction', mitigation: 'Mitigation', remediation: 'Remediation', other: 'Other' };

const sumBy = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

// ----------------------------------------------------------------------------------------------------- financials
// estimates: rows with { status, minimum_charge, chosen_tier, approved_at, sent_at, declined_at, created_at, lines[], job?, lead? }
export function financials(estimates, range, now = new Date()) {
  const rows = (estimates || []).filter((e) => e.status !== 'draft' || e.lines?.length);
  const approved = rows.filter((e) => e.status === 'approved' && inRange(e.approved_at, range));
  const declined = rows.filter((e) => e.status === 'declined' && inRange(e.declined_at, range));
  const booked = sumBy(approved, estimateCents);
  const prevApproved = range.prevFrom ? rows.filter((e) => e.status === 'approved' && inWindow(e.approved_at, range.prevFrom, range.prevTo)) : null;
  const prevBooked = prevApproved ? sumBy(prevApproved, estimateCents) : null;

  // waiting on the customer: sent and not decided (any age), and drafts not yet sent
  const sent = rows.filter((e) => e.status === 'sent');
  const drafts = rows.filter((e) => e.status === 'draft' && estimateCents(e) > 0);
  const stale = sent.filter((e) => e.sent_at && now.getTime() - at(e.sent_at) > 7 * DAY);

  const byService = SERVICE_ORDER.map((k) => {
    const mine = approved.filter((e) => estimateService(e) === k);
    return { key: k, label: SERVICE_NAMES[k], count: mine.length, cents: sumBy(mine, estimateCents) };
  }).filter((s) => s.count > 0);

  // twelve months ending this month, regardless of the range, so the trend is always visible
  const months = lastMonths(12, now);
  const perMonth = new Map(months.map((m) => [m, { key: m, label: monthLabel(m), count: 0, cents: 0 }]));
  for (const e of rows) {
    if (e.status !== 'approved' || !e.approved_at) continue;
    const m = perMonth.get(monthKey(new Date(e.approved_at)));
    if (m) { m.count += 1; m.cents += estimateCents(e); }
  }

  // estimates that moved off a sold tier / add-ons: how much add-ons and upgrades brought in (carpet options)
  const withTiers = approved.filter((e) => hasTiers(e.lines || []));
  const addOnCents = sumBy(approved, (e) => (e.lines || []).filter((l) => l.optional && l.accepted).reduce((s, l) => s + Math.round(Number(l.quantity) * Number(l.unit_price) * 100), 0));

  return {
    bookedCents: booked,
    prevBookedCents: prevBooked,
    approvedCount: approved.length,
    avgCents: approved.length ? Math.round(booked / approved.length) : 0,
    declinedCount: declined.length,
    declinedCents: sumBy(declined, estimateCents),
    winRate: pct(approved.length, approved.length + declined.length),
    sentCount: sent.length,
    sentCents: sumBy(sent, estimateCents),
    staleCount: stale.length,
    draftCount: drafts.length,
    draftCents: sumBy(drafts, estimateCents),
    byService,
    months: [...perMonth.values()],
    tieredCount: withTiers.length,
    addOnCents,
  };
}

// ----------------------------------------------------------------------------------------------------- invoices and payments
// invoices: { status, total_cents, credit_cents, interest_cents, balance_cents, due_date, issued_at, paid_at }
// payments: { amount_cents (negative = refund), tip_cents, method, received_at }
// Collected is money actually received in the window, net of refunds, tips counted apart (a tip is not invoice revenue).
export function invoiceStats(invoices, payments, range, now = new Date(), today = todayIn('America/Chicago', now)) {
  const live = (invoices || []).filter((i) => i.status !== 'void');
  const pays = payments || [];
  const inR = pays.filter((p) => inRange(p.received_at, range));
  const collected = sumBy(inR, (p) => p.amount_cents);
  const prevCollected = range.prevFrom ? sumBy(pays.filter((p) => inWindow(p.received_at, range.prevFrom, range.prevTo)), (p) => p.amount_cents) : null;
  const issued = live.filter((i) => i.issued_at && inRange(i.issued_at, range));
  const aging = agingTotals(live, today);
  const pastDue = live.filter((i) => isPastDue(i, today));
  const drafts = live.filter((i) => i.status === 'draft');

  const months = lastMonths(12, now);
  const perMonth = new Map(months.map((m) => [m, { key: m, label: monthLabel(m), count: 0, cents: 0 }]));
  for (const p of pays) {
    if (!p.received_at) continue;
    const m = perMonth.get(monthKey(new Date(p.received_at)));
    if (m) m.cents += p.amount_cents;
  }

  const byMethod = {};
  for (const p of inR) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount_cents;

  const paidNow = live.filter((i) => i.status === 'paid' && i.paid_at && i.issued_at && inRange(i.paid_at, range));
  const days = paidNow.map((i) => Math.max(0, daysBetween(String(i.issued_at).slice(0, 10), String(i.paid_at).slice(0, 10))));

  return {
    collectedCents: collected,
    prevCollectedCents: prevCollected,
    tipCents: sumBy(inR, (p) => p.tip_cents || 0),
    invoicedCents: sumBy(issued, (i) => i.total_cents - i.credit_cents + i.interest_cents),
    invoicedCount: issued.length,
    owedCents: aging.total,
    aging,
    pastDueCount: pastDue.length,
    pastDueCents: sumBy(pastDue, (i) => i.balance_cents),
    draftCount: drafts.length,
    draftCents: sumBy(drafts, (i) => i.balance_cents),
    openCount: live.filter((i) => (i.status === 'sent' || i.status === 'partial') && i.balance_cents > 0).length,
    avgDaysToPay: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
    byMethod,
    months: [...perMonth.values()],
  };
}
export { AGING };

// ----------------------------------------------------------------------------------------------------- customers
// customers: { id, display_name, customer_type, created_at, last_visit_at }; jobs: { customer_id }; plans: service_plans rows
export function customerStats(customers, jobs, estimates, plans, range, now = new Date()) {
  const list = customers || [];
  const jobCount = new Map();
  for (const j of jobs || []) if (j.customer_id) jobCount.set(j.customer_id, (jobCount.get(j.customer_id) || 0) + 1);
  const byType = {};
  for (const c of list) byType[c.customer_type] = (byType[c.customer_type] || 0) + 1;

  const names = new Map(list.map((c) => [c.id, c.display_name]));
  const booked = new Map(); // customer id -> { cents, count } booked in the range
  for (const e of estimates || []) {
    if (e.status !== 'approved' || !inRange(e.approved_at, range)) continue;
    const id = e.job?.customer_id || e.lead?.customer_id;
    if (!id) continue;
    const cur = booked.get(id) || { id, cents: 0, count: 0 };
    cur.cents += estimateCents(e);
    cur.count += 1;
    booked.set(id, cur);
  }
  const top = [...booked.values()].sort((a, b) => b.cents - a.cents).slice(0, 10).map((o) => ({ ...o, name: names.get(o.id) || 'Customer' }));

  const active = (plans || []).filter((p) => p.status === 'active');
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueSoon = active.filter((p) => { const d = new Date(`${p.next_due}T12:00:00`); return d.getTime() < today.getTime() + 30 * DAY; });
  const overdue = active.filter((p) => new Date(`${p.next_due}T12:00:00`).getTime() < today.getTime());
  const repeat = list.filter((c) => (jobCount.get(c.id) || 0) >= 2).length;
  const withJobs = list.filter((c) => (jobCount.get(c.id) || 0) >= 1).length;

  // 12 months of "new customers"
  const months = lastMonths(12, now);
  const perMonth = new Map(months.map((m) => [m, { key: m, label: monthLabel(m), count: 0 }]));
  for (const c of list) { const m = perMonth.get(c.created_at ? monthKey(new Date(c.created_at)) : ''); if (m) m.count += 1; }

  return {
    total: list.length,
    newInRange: list.filter((c) => inRange(c.created_at, range)).length,
    newPrev: range.prevFrom ? list.filter((c) => inWindow(c.created_at, range.prevFrom, range.prevTo)).length : null,
    withJobs,
    repeat,
    repeatRate: pct(repeat, withJobs),
    byType,
    top,
    plansActive: active.length,
    plansDueSoon: dueSoon.length,
    plansOverdue: overdue.length,
    plansPerYearCents: Math.round(sumBy(active, (p) => (p.price ? (Number(p.price) * 12) / p.interval_months : 0)) * 100),
    newPerMonth: [...perMonth.values()],
  };
}

// ----------------------------------------------------------------------------------------------------- jobs and leads
export const OPEN_JOB = ['booked', 'on_the_way', 'in_progress'];

export function workStats(jobs, leads, range) {
  const js = jobs || [];
  const ls = leads || [];
  const open = js.filter((j) => OPEN_JOB.includes(j.status));
  const done = js.filter((j) => ['completed', 'closed'].includes(j.status) && inRange(j.completed_at || j.updated_at, range));
  const byService = SERVICE_ORDER.map((k) => ({ key: k, label: SERVICE_NAMES[k], open: open.filter((j) => (serviceOf(j) || 'other') === k).length, done: done.filter((j) => (serviceOf(j) || 'other') === k).length }))
    .filter((s) => s.open || s.done);
  const made = ls.filter((l) => inRange(l.created_at, range));
  const lead = { total: made.length };
  for (const k of ['new', 'quoted', 'accepted', 'booked', 'lost']) lead[k] = made.filter((l) => l.status === k).length;
  const decided = lead.booked + lead.lost;
  return {
    openCount: open.length,
    byStatus: OPEN_JOB.map((k) => ({ key: k, count: open.filter((j) => j.status === k).length })),
    doneCount: done.length,
    byService,
    lead: { ...lead, bookRate: pct(lead.booked, decided) },
    readyToSchedule: ls.filter((l) => l.status === 'accepted').length,
    waitingOnCustomer: ls.filter((l) => l.status === 'quoted').length,
  };
}

const dollarsText = (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// What the owner should look at today, most important first. Each: { key, text, href }.
export function attentionItems({ fin, work, problemsOpen = 0, unassigned = 0, equipmentRepair = 0, cust, inv }) {
  const out = [];
  const s = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (problemsOpen > 0) out.push({ key: 'problems', text: `${s(problemsOpen, 'customer problem report is', 'customer problem reports are')} waiting to be handled`, href: '/jobs' });
  if (inv?.pastDueCount > 0) out.push({ key: 'pastdue', text: `${s(inv.pastDueCount, 'invoice is', 'invoices are')} past due (${dollarsText(inv.pastDueCents)} owed)`, href: '/invoices' });
  if (inv?.draftCount > 0) out.push({ key: 'drafts', text: `${s(inv.draftCount, 'invoice is', 'invoices are')} drafted and not sent`, href: '/invoices' });
  if (work?.readyToSchedule > 0) out.push({ key: 'ready', text: `${s(work.readyToSchedule, 'approved estimate is', 'approved estimates are')} ready to schedule`, href: '/leads' });
  if (unassigned > 0) out.push({ key: 'unassigned', text: `${s(unassigned, 'upcoming visit has', 'upcoming visits have')} no tech assigned`, href: '/jobs?unassigned=1' });
  if (fin?.staleCount > 0) out.push({ key: 'stale', text: `${s(fin.staleCount, 'estimate has', 'estimates have')} been out for more than a week with no answer`, href: '/leads' });
  if (cust?.plansOverdue > 0) out.push({ key: 'plans', text: `${s(cust.plansOverdue, 'cleaning plan is', 'cleaning plans are')} past its due date`, href: '/customers' });
  if (equipmentRepair > 0) out.push({ key: 'repair', text: `${s(equipmentRepair, 'machine is', 'machines are')} in repair`, href: '/equipment' });
  return out;
}

// "+12%" / "-8%" against the window before, or '' when there is nothing to compare
export function changeText(now, before) {
  if (before === null || before === undefined) return '';
  if (before === 0) return now > 0 ? 'new' : '';
  const p = Math.round(((now - before) / before) * 100);
  return `${p > 0 ? '+' : ''}${p}%`;
}
