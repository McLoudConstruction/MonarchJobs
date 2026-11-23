// Runs the customer reminders (rebooking, plan offers, plan reminders). Server only.
// planOutreach (lib/outreach.js) decides who gets what; this loads the data, sends, and records what was delivered.
// A message is recorded only when a text or email actually went out, so a missing Twilio or Resend setup retries later.
import { sendSms, sendEmail } from './notify.js';
import { planOutreach, buildOutreachMessages, KIND_LABELS } from './outreach.js';
import { runEstimateFollowups } from './estimateFollowupServer.js';
import { contactKeys } from './estimateFollowup.js';
import { runSlowDayOffers } from './slowDayServer.js';

const MAX_PER_RUN = 200;
const OPEN_JOB = ['booked', 'on_the_way', 'in_progress'];
const OPEN_LEAD = ['new', 'quoted', 'accepted'];

async function all(query, pageSize = 1000) {
  const out = [];
  for (let from = 0; from < 20000; from += pageSize) {
    const { data, error } = await query().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

export async function loadOutreachInputs(admin) {
  const { data: settings } = await admin.from('settings').select('*').eq('id', 1).maybeSingle();
  const [people, jobs, leads, plans, log] = await Promise.all([
    all(() => admin.from('customers').select('id,display_name,first_name,phone,email,marketing_opt_out,last_visit_at').eq('archived', false).order('id')),
    all(() => admin.from('jobs').select('id,customer_id,customer_token,job_type,status,completed_at').order('id')),
    all(() => admin.from('leads').select('id,customer_id,status').not('customer_id', 'is', null).in('status', OPEN_LEAD).order('id')),
    all(() => admin.from('service_plans').select('id,customer_id,status,next_due,interval_months,name').in('status', ['active', 'paused']).order('id')),
    all(() => admin.from('outreach_log').select('customer_id,dedupe_key').order('id')),
  ]);
  const lastJob = new Map();
  const open = new Set(leads.map((l) => l.customer_id));
  for (const j of jobs) {
    if (OPEN_JOB.includes(j.status)) open.add(j.customer_id);
    if (!['completed', 'closed'].includes(j.status)) continue;
    const cur = lastJob.get(j.customer_id);
    if (!cur || String(j.completed_at || '') > String(cur.completed_at || '')) lastJob.set(j.customer_id, j);
  }
  const customers = people.map((c) => {
    const j = lastJob.get(c.id);
    return {
      id: c.id, display_name: c.display_name, first_name: c.first_name, phone: c.phone, email: c.email,
      opt_out: !!c.marketing_opt_out, last_visit_at: c.last_visit_at || j?.completed_at || null,
      last_job: j ? { id: j.id, token: j.customer_token, type: j.job_type } : null,
      has_open_work: open.has(c.id),
    };
  });
  return { settings: settings || {}, customers, plans, logged: log.map((l) => `${l.customer_id}|${l.dedupe_key}`) };
}

// dryRun: only list who would be messaged (the owner's preview in Settings).
export async function runOutreach({ admin, origin, dryRun = false, now = new Date() }) {
  const inputs = await loadOutreachInputs(admin);
  const { settings, customers, plans, logged } = inputs;
  const due = planOutreach({ now, tz: settings.timezone || 'America/Chicago', settings, customers, plans, logged });
  const custom = { rebook: settings.rebook_message, plan_offer: settings.plan_offer_message, plan_reminder: settings.plan_remind_message };
  // One message per person per day: whoever gets a reminder below is skipped by the estimate follow-ups.
  const keysOf = (d) => contactKeys({ customer_id: d.customer_id, phone: d.phone, email: d.email });
  if (dryRun) {
    const f = await runEstimateFollowups({ admin, origin, dryRun: true, now, alsoBlocked: due.flatMap(keysOf) });
    let slow = { items: [] };
    try { slow = await runSlowDayOffers({ admin, origin, inputs, dryRun: true, now, alsoBlocked: due.flatMap(keysOf) }); } catch (e) { slow = { items: [{ customer: 'Slow-day offers', kind: 'Could not check', detail: e.message, phone: false, email: false }] }; }
    const items = [...due.map((d) => ({ customer: d.name, kind: KIND_LABELS[d.kind], detail: d.detail, phone: !!d.phone, email: !!d.email })), ...f.items, ...slow.items];
    return { dryRun: true, total: items.length, items: items.slice(0, 100) };
  }

  let sent = 0;
  const skipped = [];
  const reached = [];
  for (const d of due.slice(0, MAX_PER_RUN)) {
    const link = `${origin}/c/${d.token}`;
    const m = buildOutreachMessages({ kind: d.kind, custom: custom[d.kind], business: settings.business_name, firstName: d.first_name, link });
    const [sms, email] = await Promise.all([
      d.phone ? sendSms({ to: d.phone, body: m.sms }) : { status: 'skipped', detail: 'No phone number on file.' },
      d.email ? sendEmail({ to: d.email, subject: m.subject, html: m.html, text: m.text }) : { status: 'skipped', detail: 'No email on file.' },
    ]);
    if (sms.status !== 'sent' && email.status !== 'sent') { skipped.push({ customer: d.name, sms: sms.detail, email: email.detail }); continue; }
    const { error } = await admin.from('outreach_log').insert({
      customer_id: d.customer_id, job_id: d.job_id, kind: d.kind, dedupe_key: d.dedupe,
      results: { sms: { status: sms.status, detail: sms.detail }, email: { status: email.status, detail: email.detail } },
    });
    if (!error) { sent += 1; reached.push(...keysOf(d)); }
  }
  // Estimate follow-ups share the daily run. A failure there never undoes what was already sent above.
  let estimateFollowups = { due: 0, sent: 0, skipped: [] };
  let followupKeys = [];
  try {
    const f = await runEstimateFollowups({ admin, origin, now, alsoBlocked: reached });
    estimateFollowups = { due: f.due, sent: f.sent, skipped: f.skipped };
    followupKeys = [...(f.sentKeys || [])];
  } catch (e) {
    estimateFollowups = { due: 0, sent: 0, skipped: [], error: e.message };
  }
  // Slow-day offers go last, so anyone already messaged above today is skipped. A failure here never undoes what was sent.
  let slowDay = { due: 0, sent: 0, skipped: [] };
  try {
    const s = await runSlowDayOffers({ admin, origin, inputs, now, alsoBlocked: [...reached, ...followupKeys] });
    slowDay = { due: s.due, sent: s.sent, skipped: s.skipped };
  } catch (e) {
    slowDay = { due: 0, sent: 0, skipped: [], error: e.message };
  }
  return { dryRun: false, due: due.length, sent, skipped: skipped.slice(0, 20), estimate_followups: estimateFollowups, slow_day: slowDay };
}
