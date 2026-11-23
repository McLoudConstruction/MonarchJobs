// Commission calculator (#84). Owner only. Pure.
//
// Each person has one rule: a percent, taken either of what customers PAID on the jobs they worked, or of the job's MARGIN
// (what it brought in minus what it cost). A job's amount is shared between the people who clocked time on it, by their share of
// the minutes, so a job two people worked is split by who spent the time.
//   paid basis    money received in the period on the job's invoices, refunds taken off, tips left out
//   margin basis  jobs finished in the period: revenue minus purchases, labor and equipment (lib/jobCost.js). A job with no revenue
//                 or a loss earns nothing and never goes negative.
import { toCsv } from './csv.js';

export const COMMISSION_BASIS = {
  paid: { label: 'Percent of paid invoices', short: 'of paid invoices' },
  margin: { label: 'Percent of margin', short: 'of margin' },
};
export const COMMISSION_BASIS_KEYS = Object.keys(COMMISSION_BASIS);

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

// A rule typed in a form. Returns { error } or { value: { basis, percent } } with the percent to two decimals, 0 to 100.
export function cleanRule({ basis, percent }) {
  if (!COMMISSION_BASIS[basis]) return { error: 'Pick what the percent is taken from.' };
  const text = String(percent ?? '').replace('%', '').trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return { error: 'Enter a percent like 5 or 7.5.' };
  const p = Number(text);
  if (p > 100) return { error: 'A percent cannot be more than 100.' };
  return { value: { basis, percent: Math.round(p * 100) / 100 } };
}

// minutes by person -> [{ staffId, share }] where the shares add up to 1. People with no minutes are left out.
export function shares(byStaff) {
  const entries = Object.entries(byStaff || {}).map(([id, m]) => [id, Math.max(0, num(m))]).filter(([, m]) => m > 0);
  const total = entries.reduce((n, [, m]) => n + m, 0);
  return total > 0 ? entries.map(([staffId, m]) => ({ staffId, share: m / total })) : [];
}

// rules: { [staffId]: { basis, percent } }; people: [{ id, name }]
// jobs:  [{ jobId, number, customer, byStaff: { staffId: minutes }, paidCents, marginCents, finishedInPeriod }]
//        paidCents: net payments received in the period; marginCents: null when the job has no revenue to compare against.
// Returns { people: [{ staffId, name, hasRule, basis, percent, lines, basisCents, commissionCents }], totalCents,
//           unassigned: [{ jobId, number, customer, basisCents }], noMargin: number }
//   unassigned: jobs with an amount to pay on but no one clocked time on them, so no one is credited
//   noMargin: jobs finished in the period that count for margin rules but have no revenue figure
export function commissionReport({ rules = {}, people = [], jobs = [] }) {
  const byId = new Map(people.map((p) => [p.id, { staffId: p.id, name: p.name, hasRule: false, basis: null, percent: 0, lines: [], basisCents: 0, commissionCents: 0 }]));
  const get = (id) => {
    if (!byId.has(id)) byId.set(id, { staffId: id, name: 'Former team member', hasRule: false, basis: null, percent: 0, lines: [], basisCents: 0, commissionCents: 0 });
    return byId.get(id);
  };
  for (const [id, r] of Object.entries(rules || {})) {
    const row = get(id);
    if (r && COMMISSION_BASIS[r.basis]) { row.hasRule = true; row.basis = r.basis; row.percent = num(r.percent); }
  }
  const unassigned = []; let noMargin = 0;
  for (const j of jobs) {
    const crew = shares(j.byStaff);
    // Each person is paid on the basis their own rule names, so work out both amounts once per job.
    const paid = Math.max(0, num(j.paidCents));
    const marginKnown = j.marginCents != null;
    const margin = marginKnown ? Math.max(0, num(j.marginCents)) : 0;
    if (j.finishedInPeriod && !marginKnown) noMargin += 1;
    if (!crew.length) {
      if (paid > 0) unassigned.push({ jobId: j.jobId, number: j.number, customer: j.customer || '', basisCents: paid });
      continue;
    }
    for (const { staffId, share } of crew) {
      const row = get(staffId);
      if (!row.hasRule) continue;
      const amount = row.basis === 'paid' ? paid : (j.finishedInPeriod ? margin : 0);
      if (!(amount > 0)) continue;
      const basisCents = Math.round(amount * share);
      const commissionCents = Math.round((basisCents * row.percent) / 100);
      row.lines.push({ jobId: j.jobId, number: j.number, customer: j.customer || '', sharePct: Math.round(share * 1000) / 10, jobBasisCents: amount, basisCents, commissionCents });
      row.basisCents += basisCents; row.commissionCents += commissionCents;
    }
  }
  const list = [...byId.values()].filter((r) => r.hasRule || r.lines.length).sort((a, b) => b.commissionCents - a.commissionCents || a.name.localeCompare(b.name));
  return { people: list, totalCents: list.reduce((n, r) => n + r.commissionCents, 0), unassigned, noMargin };
}

export function commissionCsv(report, periodText) {
  const dollars = (c) => (num(c) / 100).toFixed(2);
  const rows = [['Employee', 'Rule', 'Job', 'Customer', 'Their share of the job', 'Amount the percent is taken from', 'Commission', 'Period']];
  for (const p of report.people) {
    const rule = p.hasRule ? `${p.percent}% ${COMMISSION_BASIS[p.basis].short}` : 'No rule';
    for (const l of p.lines) rows.push([p.name, rule, l.number ? `#${l.number}` : '', l.customer, `${l.sharePct}%`, dollars(l.basisCents), dollars(l.commissionCents), periodText]);
    rows.push([p.name, rule, 'Total', '', '', dollars(p.basisCents), dollars(p.commissionCents), periodText]);
  }
  return toCsv(rows);
}
