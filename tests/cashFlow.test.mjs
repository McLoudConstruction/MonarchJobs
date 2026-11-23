import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionLag, forecast, bookedWork, addDays, RISK_DAYS } from '../lib/cashFlow.js';

const TODAY = '2026-11-23';
const paid = (issued, paidOn) => ({ status: 'paid', issued_at: `${issued}T15:00:00Z`, paid_at: `${paidOn}T15:00:00Z` });
const open = (over = {}) => ({ id: 'i1', invoice_number: 101, job_id: 'j1', status: 'sent', balance_cents: 100000, issued_at: '2026-11-20T15:00:00Z', due_date: '2026-12-04', ...over });

test('the payment delay is the middle value of the invoices paid in the last year, or the terms until there are five', () => {
  const few = collectionLag([paid('2026-10-01', '2026-10-11'), paid('2026-10-02', '2026-10-12')], TODAY, 14);
  assert.deepEqual(few, { days: 14, samples: 2, source: 'terms' });
  const five = [10, 12, 30, 9, 11].map((d, i) => paid(`2026-09-0${i + 1}`, addDays(`2026-09-0${i + 1}`, d)));
  assert.deepEqual(collectionLag(five, TODAY, 14), { days: 11, samples: 5, source: 'history' });
  const six = [4, 6, 8, 10, 12, 14].map((d) => paid('2026-09-01', addDays('2026-09-01', d)));
  assert.equal(collectionLag(six, TODAY, 14).days, 9); // between 8 and 10
});

test('old, unpaid, voided and unpaid-yet invoices do not count towards the delay', () => {
  const rows = [paid('2024-01-01', '2024-03-01'), { status: 'sent', issued_at: '2026-10-01T00:00:00Z' }, { status: 'paid', issued_at: null, paid_at: '2026-10-05T00:00:00Z' }];
  assert.equal(collectionLag(rows, TODAY, 30).samples, 0);
});

test('an open invoice is expected on the issue date plus the delay, in the right week', () => {
  const f = forecast({ invoices: [open()], today: TODAY, termsDays: 14 });
  // issued Nov 20 + 14 days = Dec 4, which is 11 days from Nov 23 -> week 2 (index 1)
  assert.equal(f.weeks[1].invoicesCents, 100000);
  assert.equal(f.weeks.filter((w) => w.invoicesCents > 0).length, 1);
  assert.equal(f.openCents, 100000);
  assert.equal(f.totalCents, 100000);
  assert.equal(f.weeks[7].cumulativeCents, 100000);
  assert.equal(f.weeks[0].cumulativeCents, 0);
});

test('an invoice already later than customers usually pay counts in week 1 and is marked late', () => {
  const f = forecast({ invoices: [open({ issued_at: '2026-10-01T15:00:00Z', due_date: '2026-10-15' })], today: TODAY, termsDays: 14 });
  assert.equal(f.weeks[0].invoicesCents, 100000);
  assert.equal(f.weeks[0].lateCents, 100000);
  assert.equal(f.weeks[0].items[0].late, true);
});

test('an invoice more than 60 days past due is a risk, not part of the forecast', () => {
  const f = forecast({ invoices: [open({ issued_at: '2026-08-01T15:00:00Z', due_date: '2026-08-15' })], today: TODAY, termsDays: 14 });
  assert.equal(f.riskCents, 100000);
  assert.equal(f.totalCents, 0);
  assert.ok(RISK_DAYS === 60);
  const edge = forecast({ invoices: [open({ due_date: addDays(TODAY, -60), issued_at: '2026-09-01T00:00:00Z' })], today: TODAY });
  assert.equal(edge.riskCents, 0, 'exactly 60 days late is still counted');
});

test('only the balance still owing is counted, and paid, draft and void invoices are skipped', () => {
  const f = forecast({
    invoices: [open({ balance_cents: 40000 }), open({ id: 'p', status: 'paid', balance_cents: 0 }), open({ id: 'd', status: 'draft', balance_cents: 90000 }), open({ id: 'v', status: 'void', balance_cents: 90000 }), open({ id: 'z', status: 'partial', balance_cents: 0 })],
    today: TODAY, termsDays: 14,
  });
  assert.equal(f.totalCents, 40000);
});

test('booked work is expected when the last visit is done plus the delay, and today counts for a finished job', () => {
  const booked = [{ jobId: 'a', number: 5, customer: 'Lee', cents: 50000, finishDate: '2026-12-01' }, { jobId: 'b', number: 6, customer: 'Ng', cents: 30000, finishDate: '2026-11-10' }, { jobId: 'c', number: 7, customer: 'Ox', cents: 20000, finishDate: null }];
  const f = forecast({ invoices: [], booked, today: TODAY, termsDays: 14 });
  // Dec 1 + 14 = Dec 15 -> 22 days out -> week 4 (index 3); the other two pay on today + 14 = Dec 7 -> 14 days -> week 3 (index 2)
  assert.equal(f.weeks[3].bookedCents, 50000);
  assert.equal(f.weeks[2].bookedCents, 50000);
  assert.equal(f.totalCents, 100000);
});

test('money expected after the eight weeks is reported but not added to the weeks', () => {
  const f = forecast({ invoices: [], booked: [{ jobId: 'a', cents: 70000, finishDate: '2027-03-01' }], today: TODAY, termsDays: 14 });
  assert.equal(f.beyondCents, 70000);
  assert.equal(f.totalCents, 0);
});

test('the weeks are eight seven-day windows that start today', () => {
  const f = forecast({ invoices: [], today: TODAY });
  assert.equal(f.weeks.length, 8);
  assert.equal(f.weeks[0].start, TODAY); assert.equal(f.weeks[0].end, '2026-11-29');
  assert.equal(f.weeks[1].start, '2026-11-30');
  assert.equal(f.weeks[7].end, '2027-01-17');
});

test('booked work leaves out jobs that already have a sent invoice, uses a draft invoice total when there is one, and skips cancelled visits', () => {
  const jobs = [
    { id: 'a', job_number: 1, status: 'booked', customer: 'A' },
    { id: 'b', job_number: 2, status: 'completed', customer: 'B' },
    { id: 'c', job_number: 3, status: 'in_progress', customer: 'C' },
    { id: 'd', job_number: 4, status: 'cancelled', customer: 'D' },
    { id: 'e', job_number: 5, status: 'booked', customer: 'E' },
  ];
  const estimates = { a: 80000, b: 60000, c: 40000, d: 99999 };
  const invoices = [{ job_id: 'b', status: 'draft', total_cents: 65000, credit_cents: 5000 }, { job_id: 'c', status: 'sent', total_cents: 40000 }];
  const visits = [{ job_id: 'a', starts_at: '2026-12-02T15:00:00Z', status: 'scheduled' }, { job_id: 'a', starts_at: '2026-12-20T15:00:00Z', status: 'cancelled' }];
  const out = bookedWork({ jobs, estimates, invoices, visits });
  assert.deepEqual(out.map((o) => o.jobId), ['a', 'b']);
  assert.equal(out[0].cents, 80000); assert.equal(out[0].finishDate, '2026-12-02');
  assert.equal(out[1].cents, 60000); // draft total minus credit
});
