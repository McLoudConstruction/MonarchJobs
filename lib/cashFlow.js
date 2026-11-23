// Cash-flow forecast (#108): what is likely to come in over the next 8 weeks. Owner only. Pure.
//
// Two sources:
//   open invoices   sent or part paid, with a balance. Expected on the day it was issued plus how long customers usually take to
//                   pay (the middle value of paid invoices over the last year, or the invoice terms until there are 5 of them).
//   booked work     approved jobs not yet invoiced (and invoice drafts not yet sent): expected when the work finishes (its last
//                   visit, or today if that has passed) plus the same payment delay.
// An invoice that should already have been paid by that measure counts in week 1 ("late"). One more than 60 days past due is left
// out of the weeks and shown on its own as a collection risk, so a stuck invoice does not prop up the forecast.
// It is an estimate from past habits: it does not know a customer's plans, and says so on the screen.
import { daysBetween } from './invoice.js';

export const WEEKS = 8;
export const MIN_SAMPLES = 5;
export const RISK_DAYS = 60;
const DAY = 86400000;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const dkey = (v) => (v ? String(v).slice(0, 10) : null);
export const addDays = (key, n) => new Date(Date.parse(`${key}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// Days from issue to payment of the invoices paid in the last year. { days, samples, source: 'history' | 'terms' }
export function collectionLag(invoices, today, termsDays = 14) {
  const lags = [];
  for (const i of invoices || []) {
    if (i.status !== 'paid' || !i.issued_at || !i.paid_at) continue;
    const paid = dkey(i.paid_at); const issued = dkey(i.issued_at);
    if (daysBetween(paid, today) > 365 || paid > today) continue;
    lags.push(Math.max(0, daysBetween(issued, paid)));
  }
  if (lags.length < MIN_SAMPLES) return { days: Math.max(0, Math.round(num(termsDays))), samples: lags.length, source: 'terms' };
  lags.sort((a, b) => a - b);
  const mid = Math.floor(lags.length / 2);
  const days = lags.length % 2 ? lags[mid] : Math.round((lags[mid - 1] + lags[mid]) / 2);
  return { days, samples: lags.length, source: 'history' };
}

// invoices: rows with { id, invoice_number, status, balance_cents, total_cents, issued_at, paid_at, due_date, job_id }
// booked: [{ jobId, number, customer, cents, finishDate }] (finishDate 'YYYY-MM-DD' or null for "no visit on the calendar")
export function forecast({ invoices = [], booked = [], today, termsDays = 14, weeks = WEEKS }) {
  const lag = collectionLag(invoices, today, termsDays);
  const buckets = Array.from({ length: weeks }, (_, i) => ({ index: i, start: addDays(today, i * 7), end: addDays(today, i * 7 + 6), invoicesCents: 0, bookedCents: 0, lateCents: 0, items: [] }));
  const end = buckets[buckets.length - 1].end;
  let beyondCents = 0; let riskCents = 0; let openCents = 0; let bookedCents = 0; let lateCents = 0;

  const place = (date, cents, kind, label, extra = {}) => {
    const late = date < today;
    const d = late ? today : date;
    if (d > end) { beyondCents += cents; return; }
    const b = buckets[Math.min(weeks - 1, Math.floor(daysBetween(today, d) / 7))];
    if (kind === 'invoice') b.invoicesCents += cents; else b.bookedCents += cents;
    if (late) { b.lateCents += cents; lateCents += cents; }
    b.items.push({ kind, label, cents, late, ...extra });
  };

  for (const i of invoices) {
    if (i.status !== 'sent' && i.status !== 'partial') continue;
    const cents = num(i.balance_cents);
    if (!(cents > 0)) continue;
    const pastDue = i.due_date && i.due_date < today ? daysBetween(i.due_date, today) : 0;
    if (pastDue > RISK_DAYS) { riskCents += cents; continue; }
    openCents += cents;
    const issued = dkey(i.issued_at) || today;
    place(addDays(issued, lag.days), cents, 'invoice', i.invoice_number ? `Invoice #${i.invoice_number}` : 'Invoice', { invoiceId: i.id, jobId: i.job_id });
  }
  for (const b of booked) {
    const cents = num(b.cents);
    if (!(cents > 0)) continue;
    bookedCents += cents;
    const finish = b.finishDate && b.finishDate > today ? b.finishDate : today;
    place(addDays(finish, lag.days), cents, 'booked', `${b.number ? `Job #${b.number}` : 'Job'}${b.customer ? `, ${b.customer}` : ''}`, { jobId: b.jobId });
  }
  let running = 0;
  for (const b of buckets) { b.totalCents = b.invoicesCents + b.bookedCents; running += b.totalCents; b.cumulativeCents = running; }
  return { weeks: buckets, lag, openCents, bookedCents, lateCents, beyondCents, riskCents, totalCents: running };
}

// Booked work from the rows the screen reads. jobs: [{ id, job_number, status, customer }]; estimates: { [jobId]: cents } (approved);
// invoices: all invoices (any status); visits: [{ job_id, starts_at, status }]. A job counts while it is booked, under way, or
// finished with no invoice sent yet. A job that already has a sent invoice is in the invoice part of the forecast, not here.
export function bookedWork({ jobs = [], estimates = {}, invoices = [], visits = [] }) {
  const sentJobs = new Set(invoices.filter((i) => i.status !== 'draft' && i.status !== 'void').map((i) => i.job_id));
  const drafts = new Map();
  for (const i of invoices) if (i.status === 'draft') drafts.set(i.job_id, Math.max(drafts.get(i.job_id) || 0, num(i.total_cents) - num(i.credit_cents)));
  const lastVisit = new Map();
  for (const v of visits) {
    if (v.status === 'cancelled') continue;
    const d = dkey(v.starts_at);
    if (d && (!lastVisit.has(v.job_id) || d > lastVisit.get(v.job_id))) lastVisit.set(v.job_id, d);
  }
  const out = [];
  for (const j of jobs) {
    if (!['booked', 'on_the_way', 'in_progress', 'completed'].includes(j.status) || sentJobs.has(j.id)) continue;
    const cents = drafts.get(j.id) || num(estimates[j.id]);
    if (!(cents > 0)) continue;
    out.push({ jobId: j.id, number: j.job_number, customer: j.customer || '', cents, finishDate: lastVisit.get(j.id) || null });
  }
  return out;
}
