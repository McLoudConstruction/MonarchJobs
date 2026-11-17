import test from 'node:test';
import assert from 'node:assert/strict';
import { rangeBounds, inWindow, estimateCents, financials, customerStats, workStats, attentionItems, changeText, lastMonths, monthKey } from '../lib/ownerStats.js';

const NOW = new Date(2026, 10, 16, 12, 0, 0); // Nov 16 2026, local
const iso = (y, m, d) => new Date(y, m - 1, d, 10).toISOString();
const line = (q, p, extra = {}) => ({ id: `${q}-${p}-${Math.random()}`, quantity: q, unit_price: p, ...extra });
const est = (status, lines, extra = {}) => ({ id: Math.random().toString(36), status, minimum_charge: 0, lines, job: { service: 'carpet', customer_id: 'c1' }, ...extra });

test('ranges: month starts on the 1st, windows before are the same length', () => {
  const m = rangeBounds('month', NOW);
  assert.equal(m.from.getDate(), 1);
  assert.equal(m.prevFrom.getMonth(), 9); // October
  const d = rangeBounds('30d', NOW);
  assert.equal(d.to.getTime() - d.from.getTime(), d.from.getTime() - d.prevFrom.getTime());
  const all = rangeBounds('all', NOW);
  assert.equal(all.from, null);
  assert.equal(all.prevFrom, null);
  const y = rangeBounds('year', NOW);
  assert.equal(y.from.getMonth(), 0);
  assert.equal(y.prevFrom.getFullYear(), 2025);
});

test('inWindow is inclusive at the start and exclusive at the end, and rejects missing dates', () => {
  const from = new Date(2026, 10, 1); const to = new Date(2026, 11, 1);
  assert.equal(inWindow(from.toISOString(), from, to), true);
  assert.equal(inWindow(to.toISOString(), from, to), false);
  assert.equal(inWindow(null, from, to), false);
  assert.equal(inWindow('not a date', from, to), false);
  assert.equal(inWindow(iso(2020, 1, 1), null, null), true);
});

test('lastMonths gives twelve keys ending this month, across a year boundary', () => {
  const k = lastMonths(12, new Date(2026, 1, 10));
  assert.equal(k.length, 12);
  assert.equal(k[11], '2026-02');
  assert.equal(k[0], '2025-03');
  assert.equal(monthKey(new Date(2026, 0, 31)), '2026-01');
});

test('estimateCents: approved counts the customer choice, open counts the lowest tier and never add-ons', () => {
  const lines = [
    line(1, 100),
    line(1, 200, { tier: 'good' }), line(1, 350, { tier: 'better' }),
    line(1, 40, { optional: true, accepted: true }),
  ];
  assert.equal(estimateCents(est('sent', lines)), 30000); // 100 + lowest tier 200
  assert.equal(estimateCents(est('approved', lines, { chosen_tier: 'better' })), 49000); // 100 + 350 + ticked add-on 40
  assert.equal(estimateCents(est('approved', [line(1, 50), line(1, 40, { optional: true, accepted: false })])), 5000);
  assert.equal(estimateCents(est('draft', [])), 0);
  assert.equal(estimateCents(est('sent', [line(1, 20)], { minimum_charge: 120 })), 12000); // the job minimum applies
});

test('financials: booked is by approval date, within the range, with change from the window before', () => {
  const rows = [
    est('approved', [line(1, 500)], { approved_at: iso(2026, 11, 3) }),
    est('approved', [line(2, 250)], { approved_at: iso(2026, 11, 10), job: { service: 'mitigation', customer_id: 'c2' } }),
    est('approved', [line(1, 400)], { approved_at: iso(2026, 10, 20) }), // last month
    est('approved', [line(1, 999)], { approved_at: iso(2025, 6, 1) }),   // long ago
    est('declined', [line(1, 300)], { declined_at: iso(2026, 11, 5) }),
    est('sent', [line(1, 150)], { sent_at: iso(2026, 11, 1) }),          // out 15 days: stale
    est('sent', [line(1, 50)], { sent_at: iso(2026, 11, 14) }),
    est('draft', [line(1, 75)]),
    est('draft', []),                                                    // empty drafts are ignored
  ];
  const f = financials(rows, rangeBounds('month', NOW), NOW);
  assert.equal(f.approvedCount, 2);
  assert.equal(f.bookedCents, 100000);
  assert.equal(f.avgCents, 50000);
  assert.equal(f.prevBookedCents, 40000);
  assert.equal(changeText(f.bookedCents, f.prevBookedCents), '+150%');
  assert.equal(f.declinedCount, 1);
  assert.equal(f.winRate, 66.7);
  assert.equal(f.sentCount, 2);
  assert.equal(f.sentCents, 20000);
  assert.equal(f.staleCount, 1);
  assert.equal(f.draftCount, 1);
  assert.deepEqual(f.byService.map((s) => [s.key, s.cents]), [['carpet', 50000], ['mitigation', 50000]]);
  assert.equal(f.months.length, 12);
  const nov = f.months.find((m) => m.key === '2026-11');
  assert.equal(nov.cents, 100000);
  assert.equal(f.months.find((m) => m.key === '2026-10').cents, 40000);
  // all time includes the old one and has nothing to compare against
  const all = financials(rows, rangeBounds('all', NOW), NOW);
  assert.equal(all.approvedCount, 4);
  assert.equal(all.prevBookedCents, null);
});

test('financials: a lead estimate with no job yet is counted under its lead service; unknown is "other"', () => {
  const rows = [
    { ...est('approved', [line(1, 100)], { approved_at: iso(2026, 11, 2) }), job: null, lead: { restoration_type: 'extraction', customer_id: 'c3' } },
    { ...est('approved', [line(1, 100)], { approved_at: iso(2026, 11, 2) }), job: null, lead: null },
  ];
  const f = financials(rows, rangeBounds('month', NOW), NOW);
  assert.deepEqual(f.byService.map((s) => s.key), ['extraction', 'other']);
});

test('financials: win rate is null when nothing was decided; add-ons and tiers are tallied', () => {
  assert.equal(financials([], rangeBounds('month', NOW), NOW).winRate, null);
  const rows = [est('approved', [line(1, 100), line(1, 200, { tier: 'good' }), line(2, 25, { optional: true, accepted: true })], { approved_at: iso(2026, 11, 2), chosen_tier: 'good' })];
  const f = financials(rows, rangeBounds('month', NOW), NOW);
  assert.equal(f.tieredCount, 1);
  assert.equal(f.addOnCents, 5000);
});

test('changeText', () => {
  assert.equal(changeText(50, 100), '-50%');
  assert.equal(changeText(0, 0), '');
  assert.equal(changeText(5, 0), 'new');
  assert.equal(changeText(5, null), '');
});

test('customerStats: new, repeat, top customers by booked, plans', () => {
  const customers = [
    { id: 'c1', display_name: 'Ada', customer_type: 'residential', created_at: iso(2026, 11, 2) },
    { id: 'c2', display_name: 'Bolt Co', customer_type: 'commercial', created_at: iso(2026, 5, 2) },
    { id: 'c3', display_name: 'Cy', customer_type: 'residential', created_at: iso(2026, 10, 2) },
  ];
  const jobs = [{ customer_id: 'c1' }, { customer_id: 'c1' }, { customer_id: 'c2' }];
  const rows = [
    est('approved', [line(1, 300)], { approved_at: iso(2026, 11, 3) }),
    est('approved', [line(1, 900)], { approved_at: iso(2026, 11, 4), job: { service: 'mitigation', customer_id: 'c2' } }),
  ];
  const plans = [
    { status: 'active', next_due: '2026-11-01', interval_months: 6, price: 120 },
    { status: 'active', next_due: '2026-12-10', interval_months: 12, price: 240 },
    { status: 'active', next_due: '2027-06-01', interval_months: 3, price: null },
    { status: 'ended', next_due: '2026-11-01', interval_months: 6, price: 100 },
  ];
  const c = customerStats(customers, jobs, rows, plans, rangeBounds('month', NOW), NOW);
  assert.equal(c.total, 3);
  assert.equal(c.newInRange, 1);
  assert.equal(c.newPrev, 1);
  assert.equal(c.withJobs, 2);
  assert.equal(c.repeat, 1);
  assert.equal(c.repeatRate, 50);
  assert.deepEqual(c.byType, { residential: 2, commercial: 1 });
  assert.deepEqual(c.top.map((t) => [t.name, t.cents]), [['Bolt Co', 90000], ['Ada', 30000]]);
  assert.equal(c.plansActive, 3);
  assert.equal(c.plansOverdue, 1);
  assert.equal(c.plansDueSoon, 2);
  assert.equal(c.plansPerYearCents, 24000 + 24000); // 120 twice a year + 240 once a year
});

test('workStats: open jobs by status and service, finished in range, lead funnel', () => {
  const jobs = [
    { status: 'booked', service: 'carpet' }, { status: 'in_progress', service: 'mitigation' }, { status: 'on_the_way', job_type: 'floor_cleaning' },
    { status: 'completed', service: 'carpet', completed_at: iso(2026, 11, 5) },
    { status: 'closed', service: 'carpet', completed_at: iso(2026, 8, 5) },
    { status: 'cancelled', service: 'carpet' },
  ];
  const leads = [
    { status: 'new', created_at: iso(2026, 11, 1) }, { status: 'booked', created_at: iso(2026, 11, 2) }, { status: 'booked', created_at: iso(2026, 11, 2) },
    { status: 'lost', created_at: iso(2026, 11, 3) }, { status: 'accepted', created_at: iso(2026, 9, 3) }, { status: 'quoted', created_at: iso(2026, 11, 3) },
  ];
  const w = workStats(jobs, leads, rangeBounds('month', NOW));
  assert.equal(w.openCount, 3);
  assert.equal(w.doneCount, 1);
  assert.deepEqual(w.byService.map((s) => [s.key, s.open, s.done]), [['carpet', 2, 1], ['mitigation', 1, 0]]);
  assert.equal(w.lead.total, 5);
  assert.equal(w.lead.booked, 2);
  assert.equal(w.lead.bookRate, 66.7);
  assert.equal(w.readyToSchedule, 1); // counted regardless of the range
  assert.equal(w.waitingOnCustomer, 1);
});

test('attentionItems lists only what needs attention, most important first, with correct plurals', () => {
  assert.deepEqual(attentionItems({ fin: {}, work: {}, cust: {} }), []);
  const items = attentionItems({ fin: { staleCount: 1 }, work: { readyToSchedule: 2 }, cust: { plansOverdue: 3 }, problemsOpen: 1, unassigned: 4, equipmentRepair: 1 });
  assert.deepEqual(items.map((i) => i.key), ['problems', 'ready', 'unassigned', 'stale', 'plans', 'repair']);
  assert.match(items[0].text, /^1 customer problem report is waiting/);
  assert.match(items[1].text, /^2 approved estimates are ready/);
  assert.match(items[3].text, /^1 estimate has been out/);
});
