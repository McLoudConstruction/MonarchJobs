import test from 'node:test';
import assert from 'node:assert/strict';
import { lossGroup, serviceGroup, jobMargin, marginByGroup, marginCsvRows, LOSS_ORDER, LOSS_GROUPS, SERVICE_ORDER, SERVICE_GROUPS } from '../lib/jobMargins.js';

test('jobs are grouped by the kind of loss', () => {
  assert.equal(lossGroup({ service: 'carpet' }), 'carpet');
  assert.equal(lossGroup({ service: 'mitigation' }, 'Burst pipe'), 'water');
  assert.equal(lossGroup({ service: 'extraction' }, ''), 'water');
  assert.equal(lossGroup({ service: 'mitigation' }, 'Fire'), 'fire');
  assert.equal(lossGroup({ service: 'remediation' }, 'Smoke damage'), 'fire');
  assert.equal(lossGroup({ service: 'remediation' }, 'Sewage backup'), 'mold');
  assert.equal(lossGroup({ service: 'remediation' }, ''), 'mold');
  assert.equal(lossGroup({ service: 'mitigation' }, 'Wildfire-damaged roof') === 'fire', false, 'a word that only contains fire is not fire');
  assert.equal(lossGroup({ service: null, job_type: 'floor_cleaning' }), 'carpet');
  assert.equal(lossGroup({ service: null, job_type: 'water_restoration' }), 'water');
  assert.equal(lossGroup({ service: null, job_type: 'other' }), 'other');
  assert.equal(lossGroup(null), 'other');
});

test('the service grouping keeps older jobs that have no service', () => {
  assert.equal(serviceGroup({ service: 'extraction' }), 'extraction');
  assert.equal(serviceGroup({ job_type: 'floor_cleaning' }), 'carpet');
  assert.equal(serviceGroup({ job_type: 'water_restoration' }), 'mitigation');
  assert.equal(serviceGroup({}), 'other');
});

test('one job: revenue is the newest invoice, cost is purchases plus labor, margin is the difference', () => {
  const m = jobMargin({
    purchases: [{ amount_cents: 20000 }, { amount_cents: 5000, voided_at: '2026-11-01' }],
    time: [{ hours: 4, rate_cents: 2500 }],
    sketches: [], equipRates: {},
    invoices: [{ status: 'sent', total_cents: 100000, created_at: '2026-11-02', invoice_number: 7 }],
    estimateCents: 90000,
  });
  assert.equal(m.revenueCents, 100000);
  assert.equal(m.revenueSource, 'invoice');
  assert.equal(m.totalCents, 30000);
  assert.equal(m.marginCents, 70000);
  assert.equal(m.marginPercent, 70);
});

test('with no invoice the approved estimate is the revenue, and with neither there is no margin', () => {
  const est = jobMargin({ purchases: [{ amount_cents: 1000 }], estimateCents: 5000 });
  assert.equal(est.revenueSource, 'estimate'); assert.equal(est.marginCents, 4000);
  const none = jobMargin({ purchases: [{ amount_cents: 1000 }] });
  assert.equal(none.revenueCents, null); assert.equal(none.marginCents, null);
});

test('margins add up by group, in a fixed order, and jobs with no price are counted apart', () => {
  const rows = [
    { jobId: 1, group: 'water', revenueCents: 100000, costCents: 60000, marginCents: 40000 },
    { jobId: 2, group: 'water', revenueCents: 50000, costCents: 60000, marginCents: -10000 },
    { jobId: 3, group: 'carpet', revenueCents: 20000, costCents: 5000, marginCents: 15000 },
    { jobId: 4, group: 'fire', revenueCents: null, costCents: 100, marginCents: null },
  ];
  const r = marginByGroup(rows);
  assert.deepEqual(r.groups.map((g) => g.key), ['carpet', 'water']);
  const water = r.groups.find((g) => g.key === 'water');
  assert.equal(water.jobs, 2); assert.equal(water.revenueCents, 150000); assert.equal(water.costCents, 120000); assert.equal(water.marginCents, 30000);
  assert.equal(water.marginPercent, 20); assert.equal(water.avgMarginCents, 15000);
  assert.equal(water.label, 'Water');
  assert.equal(r.skipped, 1);
  assert.equal(r.totals.jobs, 3); assert.equal(r.totals.marginCents, 45000); assert.equal(r.totals.revenueCents, 170000);
  assert.equal(r.totals.marginPercent, 26.5);
});

test('the same rows can be grouped by service instead', () => {
  const r = marginByGroup([{ group: 'remediation', revenueCents: 1000, costCents: 400, marginCents: 600 }, { group: 'carpet', revenueCents: 500, costCents: 100, marginCents: 400 }], { order: SERVICE_ORDER, labels: SERVICE_GROUPS });
  assert.deepEqual(r.groups.map((g) => g.label), ['Carpet', 'Remediation']);
});

test('no rows gives empty groups and zero totals without dividing by zero', () => {
  const r = marginByGroup([]);
  assert.deepEqual(r.groups, []);
  assert.equal(r.totals.marginPercent, null);
  assert.equal(r.totals.avgMarginCents, 0);
});

test('the CSV has a line per group and a total line, in dollars', () => {
  const r = marginByGroup([{ group: 'water', revenueCents: 150000, costCents: 120000, marginCents: 30000 }], { order: LOSS_ORDER, labels: LOSS_GROUPS });
  const rows = marginCsvRows(r);
  assert.deepEqual(rows[0], ['Kind of work', 'Jobs', 'Revenue', 'Cost', 'Margin', 'Margin percent', 'Average margin per job']);
  assert.deepEqual(rows[1], ['Water', 1, '1500.00', '1200.00', '300.00', 20, '300.00']);
  assert.equal(rows[2][0], 'All finished jobs');
});
