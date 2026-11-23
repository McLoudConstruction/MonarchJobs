// Reads what the owner's money panels need for the jobs in a period (browser, owner only: the tables behind it are owner-only).
// Shared by Profit by kind of work and the Commission report so the numbers cannot disagree. The arithmetic itself is in
// lib/jobMargins.js and lib/commission.js, which have tests.
import { estimateCents, inWindow } from './ownerStats.js';
import { jobMargin, lossGroup, serviceGroup } from './jobMargins.js';
import { sessionMinutes } from './jobClock.js';

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const uniq = (a) => [...new Set(a.filter(Boolean))];

async function inChunks(sb, table, columns, column, ids, tweak = (q) => q) {
  const out = [];
  for (const c of chunk(ids, 80)) {
    const { data, error } = await tweak(sb.from(table).select(columns).in(column, c));
    if (error) throw new Error(error.message);
    out.push(...(data || []));
  }
  return out;
}

const JOB_COLUMNS = 'id,job_number,service,job_type,status,completed_at,lead_id,customer:customers(display_name)';

// bounds: rangeBounds() from lib/ownerStats.js. Returns one row per job that finished in the period or was paid on in it:
// { jobId, number, customer, service, group, serviceKey, finishedInPeriod, byStaff, paidCents, revenueCents, costCents, marginCents }
export async function loadJobMoney(sb, bounds) {
  const { data: finished, error } = await sb.from('jobs').select(JOB_COLUMNS)
    .in('status', ['completed', 'closed']).not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  const finishedIn = (finished || []).filter((j) => inWindow(j.completed_at, bounds.from, bounds.to));

  // payments received in the period (money collected is what the paid-invoice commission is taken from)
  let payQuery = sb.from('payments').select('invoice_id,amount_cents,received_at');
  if (bounds.from) payQuery = payQuery.gte('received_at', bounds.from.toISOString());
  payQuery = payQuery.lt('received_at', bounds.to.toISOString()).limit(5000);
  const { data: pays, error: payErr } = await payQuery;
  if (payErr) throw new Error(payErr.message);
  const paidInvoiceIds = uniq((pays || []).map((p) => p.invoice_id));
  const paidInvoices = paidInvoiceIds.length ? await inChunks(sb, 'invoices', 'id,job_id', 'id', paidInvoiceIds) : [];
  const jobOfInvoice = new Map(paidInvoices.map((i) => [i.id, i.job_id]));
  const paidByJob = new Map();
  for (const p of pays || []) {
    const job = jobOfInvoice.get(p.invoice_id);
    if (job) paidByJob.set(job, (paidByJob.get(job) || 0) + Number(p.amount_cents || 0));
  }

  const have = new Set(finishedIn.map((j) => j.id));
  const extraIds = [...paidByJob.keys()].filter((id) => !have.has(id));
  const extra = extraIds.length ? await inChunks(sb, 'jobs', JOB_COLUMNS, 'id', extraIds) : [];
  const jobs = [...finishedIn, ...extra];
  const ids = jobs.map((j) => j.id);
  if (!ids.length) return [];
  const finishedIds = finishedIn.map((j) => j.id);

  const [sessions, invoices, estimates, purchases, time, sketches, leads, rateRows] = await Promise.all([
    inChunks(sb, 'job_clock_sessions', 'job_id,staff_id,started_at,ended_at,voided_at', 'job_id', ids, (q) => q.is('voided_at', null).not('ended_at', 'is', null)),
    inChunks(sb, 'invoices', 'job_id,invoice_number,status,total_cents,created_at', 'job_id', finishedIds),
    inChunks(sb, 'estimates', 'job_id,status,minimum_charge,chosen_tier,lines:estimate_lines(id,quantity,unit_price,tier,optional,accepted)', 'job_id', finishedIds),
    inChunks(sb, 'job_purchases', 'job_id,amount_cents,voided_at', 'job_id', finishedIds, (q) => q.is('voided_at', null)),
    inChunks(sb, 'job_time_entries', 'job_id,hours,rate_cents,voided_at', 'job_id', finishedIds, (q) => q.is('voided_at', null)),
    inChunks(sb, 'job_sketches', 'job_id,id,name,plan', 'job_id', finishedIds),
    inChunks(sb, 'leads', 'id,intake', 'id', uniq(jobs.map((j) => j.lead_id))),
    sb.from('equipment_daily_rates').select('type,daily_cents').then((r) => { if (r.error) throw new Error(r.error.message); return r.data || []; }),
  ]);
  const equipRates = Object.fromEntries(rateRows.map((r) => [r.type, r.daily_cents]));
  const leadById = new Map(leads.map((l) => [l.id, l]));

  return jobs.map((j) => {
    const finishedInPeriod = have.has(j.id);
    const byStaff = {};
    for (const s of sessions.filter((x) => x.job_id === j.id)) byStaff[s.staff_id] = (byStaff[s.staff_id] || 0) + sessionMinutes(s);
    let m = null;
    if (finishedInPeriod) {
      const est = estimates.find((e) => e.job_id === j.id) || null;
      m = jobMargin({
        purchases: purchases.filter((p) => p.job_id === j.id), time: time.filter((t) => t.job_id === j.id),
        sketches: sketches.filter((s) => s.job_id === j.id), equipRates, invoices: invoices.filter((i) => i.job_id === j.id),
        estimateCents: est && est.status === 'approved' ? estimateCents(est) : null,
      });
    }
    const lossText = leadById.get(j.lead_id)?.intake?.loss_type || '';
    return {
      jobId: j.id, number: j.job_number, customer: j.customer?.display_name || '', service: j.service,
      group: lossGroup(j, lossText), serviceKey: serviceGroup(j), finishedInPeriod, byStaff,
      paidCents: paidByJob.get(j.id) || 0,
      revenueCents: m ? m.revenueCents : null, costCents: m ? m.totalCents : null, marginCents: m ? m.marginCents : null,
      revenueSource: m ? m.revenueSource : null,
    };
  });
}
