// Runs the anomaly alerts (#112). Server only. checkJob (lib/anomalies.js) decides what is worth an alert; this loads the open
// jobs, asks the database to tell the owner (once per job per kind), and clears old alerts for jobs that have finished.
// With dryRun it sends nothing and returns what would be sent, for the "who would be alerted today?" button in Settings.
import { checkJob, readAnomalySettings, anomalyKey } from './anomalies.js';
import { allottedMinutes, totalMinutes } from './jobClock.js';
import { costSummary, equipmentRunTime } from './jobCost.js';
import { estimateCents } from './ownerStats.js';
import { normalizePlan } from './sketch.js';
import { unitAt, unitCode, calendarDatesOnSite } from './equipment.js';

const OPEN = ['booked', 'on_the_way', 'in_progress'];
const CHUNK = 60;
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function inChunks(admin, table, columns, column, ids, tweak = (q) => q) {
  const out = [];
  for (const c of chunks(ids, CHUNK)) {
    const { data, error } = await tweak(admin.from(table).select(columns).in(column, c));
    if (error) throw new Error(error.message);
    out.push(...(data || []));
  }
  return out;
}

export async function runAnomalyCheck({ admin, dryRun = false, now = new Date() }) {
  const { data: row } = await admin.from('settings').select('anomaly_alerts_enabled,anomaly_hours_pct,anomaly_cost_pct,anomaly_equip_days').eq('id', 1).maybeSingle();
  const settings = readAnomalySettings(row);
  if (!dryRun && !settings.enabled) return { skipped: 'off', settings, jobs: 0, alerts: 0, sent: 0, items: [] };

  if (!dryRun) await admin.rpc('anomaly_resolve_closed');

  const { data: jobs, error } = await admin.from('jobs')
    .select('id,job_number,status,customer:customers(display_name)')
    .in('status', OPEN).limit(2000);
  if (error) throw new Error(error.message);
  const ids = (jobs || []).map((j) => j.id);
  if (!ids.length) return { settings, jobs: 0, alerts: 0, sent: 0, items: [] };

  const [estimates, sessions, purchases, time, sketches, equipRates, priceItems] = await Promise.all([
    inChunks(admin, 'estimates', 'job_id,status,minimum_charge,chosen_tier,lines:estimate_lines(id,price_item_id,unit,quantity,unit_price,tier,optional,accepted)', 'job_id', ids),
    inChunks(admin, 'job_clock_sessions', 'job_id,started_at,ended_at,voided_at', 'job_id', ids, (q) => q.is('voided_at', null)),
    inChunks(admin, 'job_purchases', 'job_id,amount_cents,voided_at', 'job_id', ids, (q) => q.is('voided_at', null)),
    inChunks(admin, 'job_time_entries', 'job_id,hours,rate_cents,voided_at', 'job_id', ids, (q) => q.is('voided_at', null)),
    inChunks(admin, 'job_sketches', 'job_id,id,name,plan', 'job_id', ids),
    admin.from('equipment_daily_rates').select('type,daily_cents').then((r) => r.data || []),
    admin.from('price_items').select('id,minutes_per_unit').then((r) => r.data || []),
  ]);
  const rates = Object.fromEntries(priceItems.map((p) => [p.id, p.minutes_per_unit]));
  const eqRates = Object.fromEntries(equipRates.map((r) => [r.type, r.daily_cents]));

  const found = [];
  for (const j of jobs) {
    const est = estimates.find((e) => e.job_id === j.id) || null;
    const mySketches = sketches.filter((s) => s.job_id === j.id);
    const equipment = equipmentRunTime(mySketches, eqRates);
    const sum = costSummary({ purchases: purchases.filter((p) => p.job_id === j.id), time: time.filter((t) => t.job_id === j.id), equipment });
    const onSite = [];
    for (const s of mySketches) {
      const plan = normalizePlan(s.plan);
      for (const u of plan.equipment || []) {
        if (unitAt(plan, u, null).state === 'on') onSite.push({ code: unitCode(u), days: calendarDatesOnSite(plan, u).length });
      }
    }
    const approved = est && est.status === 'approved';
    const facts = {
      clockedMinutes: totalMinutes(sessions.filter((s) => s.job_id === j.id), now),
      allotted: est ? allottedMinutes(est, rates) : { minutes: 0, any: false },
      costCents: sum.totalCents,
      estimateCents: approved ? estimateCents(est) : 0,
      equipment: onSite,
    };
    for (const a of checkJob({ number: j.job_number, customer: j.customer?.display_name || '' }, facts, settings)) {
      found.push({ jobId: j.id, number: j.job_number, customer: j.customer?.display_name || '', ...a, key: anomalyKey(j.id, a.kind) });
    }
  }

  // Alerts already sent are never sent again.
  const sentKeys = new Set();
  if (found.length) {
    for (const c of chunks(found.map((f) => f.key), 100)) {
      const { data } = await admin.from('notifications').select('dedupe_key').in('dedupe_key', c);
      for (const n of data || []) sentKeys.add(n.dedupe_key);
    }
  }
  const items = found.map((f) => ({ jobId: f.jobId, number: f.number, customer: f.customer, kind: f.kind, title: f.title, body: f.body, alreadySent: sentKeys.has(f.key) }));
  const fresh = found.filter((f) => !sentKeys.has(f.key));
  let sent = 0;
  if (!dryRun) {
    for (const f of fresh) {
      const { data, error: e } = await admin.rpc('anomaly_notify', { p_job: f.jobId, p_kind: f.kind, p_title: f.title, p_body: f.body });
      if (e) throw new Error(e.message);
      if (data) sent += 1;
    }
  }
  return { settings, jobs: jobs.length, alerts: found.length, newAlerts: fresh.length, sent, items };
}
