// Runs the estimate follow-ups (#11). Server only. Called by runOutreach (lib/outreachServer.js) on the same daily run.
// planEstimateFollowups (lib/estimateFollowup.js) decides who gets what; this loads the data, sends, and records
// what was delivered. A nudge is recorded only when a text or email actually went out, so a missing Twilio or Resend
// setup is retried the next day instead of being lost.
import { sendSms, sendEmail } from './notify.js';
import { planEstimateFollowups, buildFollowupMessages, contactKeys } from './estimateFollowup.js';

const MAX_PER_RUN = 100;
const CHUNK = 150;
const RECENT_HOURS = 20; // someone messaged in the last 20 hours is not messaged again, whatever the reason

async function fetchAll(query, pageSize = 1000) {
  const out = [];
  for (let from = 0; from < 20000; from += pageSize) {
    const { data, error } = await query().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

async function byIds(admin, table, columns, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await admin.from(table).select(columns).in('id', ids.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    out.push(...(data || []));
  }
  return out;
}

const uniq = (a) => [...new Set(a.filter(Boolean))];

export async function loadFollowupInputs(admin, now = new Date()) {
  const { data: settings } = await admin.from('settings').select('*').eq('id', 1).maybeSingle();
  if (!settings?.estimate_followup_enabled) return { settings: settings || {}, estimates: [], logged: [], recent: [] };

  const sent = await fetchAll(() => admin.from('estimates')
    .select('id,status,sent_at,first_viewed_at,expires_at,followups_paused,share_token,job_id,lead_id')
    .eq('status', 'sent').eq('followups_paused', false).order('id'));
  const [jobs, leads] = await Promise.all([
    byIds(admin, 'jobs', 'id,customer_id,status', uniq(sent.map((e) => e.job_id))),
    byIds(admin, 'leads', 'id,name,first_name,phone,email,customer_id,status', uniq(sent.map((e) => e.lead_id))),
  ]);
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const people = await byIds(admin, 'customers', 'id,display_name,first_name,phone,email,marketing_opt_out',
    uniq([...jobs.map((j) => j.customer_id), ...leads.map((l) => l.customer_id)]));
  const customerById = new Map(people.map((c) => [c.id, c]));

  const estimates = [];
  for (const e of sent) {
    const job = e.job_id ? jobById.get(e.job_id) : null;
    const lead = e.lead_id ? leadById.get(e.lead_id) : null;
    const customer = customerById.get(job?.customer_id || lead?.customer_id) || null;
    // With a work order the customer record is who to write to; before one, the lead's own contact details.
    const who = job && customer
      ? { name: customer.display_name, first_name: customer.first_name, phone: customer.phone, email: customer.email }
      : lead ? { name: lead.name, first_name: lead.first_name, phone: lead.phone, email: lead.email } : null;
    if (!who) continue;
    estimates.push({
      id: e.id, status: e.status, sent_at: e.sent_at, first_viewed_at: e.first_viewed_at, expires_at: e.expires_at,
      followups_paused: e.followups_paused, share_token: e.share_token,
      customer_id: customer?.id || null, opt_out: !!customer?.marketing_opt_out,
      closed: job ? job.status === 'cancelled' : lead?.status === 'lost',
      ...who,
    });
  }

  const since = new Date(now.getTime() - RECENT_HOURS * 3600 * 1000).toISOString();
  const [logRows, recentFollow, recentOutreach] = await Promise.all([
    fetchAll(() => admin.from('estimate_followups').select('estimate_id,dedupe_key').order('id')),
    fetchAll(() => admin.from('estimate_followups').select('keys').gte('at', since).order('id')),
    fetchAll(() => admin.from('outreach_log').select('customer_id').gte('at', since).order('id')),
  ]);
  return {
    settings,
    estimates,
    logged: logRows.map((r) => `${r.estimate_id}|${r.dedupe_key}`),
    recent: [...recentFollow.flatMap((r) => r.keys || []), ...recentOutreach.map((r) => `c:${r.customer_id}`)],
  };
}

// alsoBlocked: contact keys that already got (or will get) a message in this run, from the other reminders.
// dryRun: only list who would be messaged.
export async function runEstimateFollowups({ admin, origin, dryRun = false, now = new Date(), alsoBlocked = [] }) {
  const { settings, estimates, logged, recent } = await loadFollowupInputs(admin, now);
  const due = planEstimateFollowups({
    now, tz: settings.timezone || 'America/Chicago', settings, estimates, logged, blocked: new Set([...recent, ...alsoBlocked]),
  });
  const items = due.map((d) => ({ customer: d.name, kind: 'Estimate follow-up', detail: d.detail, phone: !!d.phone, email: !!d.email }));
  if (dryRun) return { due: due.length, sent: 0, skipped: [], items };

  let sent = 0;
  const skipped = [];
  const sentKeys = [];
  for (const d of due.slice(0, MAX_PER_RUN)) {
    const custom = d.opened ? settings.estimate_followup_opened : settings.estimate_followup_unopened;
    const m = buildFollowupMessages({ opened: d.opened, custom, business: settings.business_name, firstName: d.first_name, link: `${origin}/e/${d.token}` });
    const [sms, email] = await Promise.all([
      d.phone ? sendSms({ to: d.phone, body: m.sms }) : { status: 'skipped', detail: 'No phone number on file.' },
      d.email ? sendEmail({ to: d.email, subject: m.subject, html: m.html, text: m.text }) : { status: 'skipped', detail: 'No email on file.' },
    ]);
    if (sms.status !== 'sent' && email.status !== 'sent') { skipped.push({ customer: d.name, sms: sms.detail, email: email.detail }); continue; }
    const { error } = await admin.from('estimate_followups').insert({
      estimate_id: d.estimate_id, step: d.step, dedupe_key: d.dedupe, opened: d.opened, keys: d.keys,
      results: { sms: { status: sms.status, detail: sms.detail }, email: { status: email.status, detail: email.detail } },
    });
    if (!error) { sent += 1; sentKeys.push(...d.keys); }
  }
  return { due: due.length, sent, skipped: skipped.slice(0, 20), items: [], sentKeys };
}

export { contactKeys };
