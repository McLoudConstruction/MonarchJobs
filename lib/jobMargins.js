// Profit by kind of work (#107). Owner only. Pure.
//
// Each finished job's margin is what it brought in minus what it cost, worked out the same way as the job's Costs tab
// (lib/jobCost.js): purchases, labor from the clock and equipment run time against the job's newest invoice (or its approved
// estimate). Jobs are then grouped by the kind of loss, or by service.
import { costSummary, equipmentRunTime, jobRevenue } from './jobCost.js';

// ---- grouping
export const LOSS_GROUPS = {
  carpet: 'Carpet',
  water: 'Water',
  fire: 'Fire and smoke',
  mold: 'Mold and other remediation',
  other: 'Other',
};
export const LOSS_ORDER = ['carpet', 'water', 'fire', 'mold', 'other'];
export const SERVICE_GROUPS = { carpet: 'Carpet', extraction: 'Extraction', mitigation: 'Mitigation', remediation: 'Remediation', other: 'Other' };
export const SERVICE_ORDER = ['carpet', 'extraction', 'mitigation', 'remediation', 'other'];

// job: { service }, lossText: what the office wrote as the loss on the lead (intake.loss_type), '' when there is none.
// Fire and smoke come from the loss text (there is no fire service). Remediation that is not fire is mold and other cleanup.
export function lossGroup(job, lossText = '') {
  const service = job?.service || '';
  if (service === 'carpet') return 'carpet';
  const text = String(lossText || '').toLowerCase();
  if (/\b(fire|smoke|soot)\b/.test(text)) return 'fire';
  if (service === 'remediation') return 'mold';
  if (service === 'extraction' || service === 'mitigation') return 'water';
  if (job?.job_type === 'floor_cleaning') return 'carpet';
  if (job?.job_type === 'water_restoration') return 'water';
  return 'other';
}
export const serviceGroup = (job) => (SERVICE_GROUPS[job?.service] ? job.service : (job?.job_type === 'floor_cleaning' ? 'carpet' : job?.job_type === 'water_restoration' ? 'mitigation' : 'other'));

// ---- one job
// { purchases, time, sketches, equipRates, invoices, estimateCents } -> costSummary plus the revenue source
export function jobMargin({ purchases = [], time = [], sketches = [], equipRates = {}, invoices = [], estimateCents = null }) {
  const equipment = equipmentRunTime(sketches, equipRates);
  const revenue = jobRevenue(invoices, estimateCents);
  const sum = costSummary({ purchases, time, equipment, revenue });
  return { ...sum, revenueSource: revenue ? revenue.source : null, equipmentMissingRates: equipment.missing };
}

// ---- groups
// rows: [{ jobId, group, revenueCents, costCents, marginCents }]; marginCents is null when there was no revenue to compare against.
// order/labels pick the kind of grouping. Returns { groups: [{ key, label, jobs, revenueCents, costCents, marginCents, marginPercent, avgMarginCents }], totals, skipped }
export function marginByGroup(rows, { order = LOSS_ORDER, labels = LOSS_GROUPS } = {}) {
  const map = new Map();
  let skipped = 0;
  for (const r of rows || []) {
    if (r.marginCents == null || r.revenueCents == null) { skipped += 1; continue; }
    const g = map.get(r.group) || { key: r.group, label: labels[r.group] || r.group, jobs: 0, revenueCents: 0, costCents: 0, marginCents: 0 };
    g.jobs += 1; g.revenueCents += r.revenueCents; g.costCents += r.costCents; g.marginCents += r.marginCents;
    map.set(r.group, g);
  }
  const fin = (g) => ({ ...g, marginPercent: g.revenueCents > 0 ? Math.round((g.marginCents / g.revenueCents) * 1000) / 10 : null, avgMarginCents: g.jobs ? Math.round(g.marginCents / g.jobs) : 0 });
  const groups = [...map.values()].sort((a, b) => {
    const ia = order.indexOf(a.key); const ib = order.indexOf(b.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  }).map(fin);
  const totals = fin(groups.reduce((t, g) => ({ key: 'all', label: 'All finished jobs', jobs: t.jobs + g.jobs, revenueCents: t.revenueCents + g.revenueCents, costCents: t.costCents + g.costCents, marginCents: t.marginCents + g.marginCents }), { key: 'all', label: 'All finished jobs', jobs: 0, revenueCents: 0, costCents: 0, marginCents: 0 }));
  return { groups, totals, skipped };
}

export function marginCsvRows(result) {
  const d = (c) => (c / 100).toFixed(2);
  const rows = [['Kind of work', 'Jobs', 'Revenue', 'Cost', 'Margin', 'Margin percent', 'Average margin per job']];
  for (const g of [...result.groups, result.totals]) rows.push([g.label, g.jobs, d(g.revenueCents), d(g.costCents), d(g.marginCents), g.marginPercent == null ? '' : g.marginPercent, d(g.avgMarginCents)]);
  return rows;
}
