// Runs the customer reminders (rebooking, plan offers, plan reminders). Server only.
// planOutreach (lib/outreach.js) decides who gets what; this loads the data, sends, and records what was delivered.
// A message is recorded only when a text or email actually went out, so a missing Twilio or Resend setup retries later.
import { sendSms, sendEmail } from './notify.js';
import { planOutreach, buildOutreachMessages, KIND_LABELS } from './outreach.js';

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
  const { settings, customers, plans, logged } = await loadOutreachInputs(admin);
  const due = planOutreach({ now, tz: settings.timezone || 'America/Chicago', settings, customers, plans, logged });
  const custom = { rebook: settings.rebook_message, plan_offer: settings.plan_offer_message, plan_reminder: settings.plan_remind_message };
  if (dryRun) return { dryRun: true, total: due.length, items: due.slice(0, 100).map((d) => ({ customer: d.name, kind: KIND_LABELS[d.kind], detail: d.detail, phone: !!d.phone, email: !!d.email })) };

  let sent = 0;
  const skipped = [];
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
    if (!error) sent += 1;
  }
  return { dryRun: false, due: due.length, sent, skipped: skipped.slice(0, 20) };
}
