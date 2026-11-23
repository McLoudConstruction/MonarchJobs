// Server only. Loads the neighbors of a finished job, and sends one approved batch of offers.
// A message is recorded only when a text or email actually went out, so a missing Twilio or Resend setup can be retried.
import { sendSms, sendEmail } from './notify.js';
import { planStreetOffers, buildStreetOfferMessages, streetDedupe, streetKey } from './streetOffers.js';
import { contactKeys } from './estimateFollowup.js';

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

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

export async function loadStreetPlan(admin, jobId, now = new Date()) {
  const { data: settings } = await admin.from('settings').select('*').eq('id', 1).maybeSingle();
  if (!settings?.street_offers_enabled) return { enabled: false };

  const { data: job } = await admin.from('jobs').select('id,customer_id,status,address:addresses(street,city)').eq('id', jobId).maybeSingle();
  if (!job) return { enabled: true, error: 'Job not found.' };
  if (!['completed', 'closed'].includes(job.status)) return { enabled: true, error: 'Offers can go out once the job is finished.' };
  const key = streetKey(job.address?.street);
  if (!key) return { enabled: true, error: 'This job has no street name to match.' };

  // Every address in the same city, narrowed to the same street name here (the street column has numbers and units in it).
  const addresses = (await all(() => admin.from('addresses').select('id,customer_id,street,city').ilike('city', job.address.city || '').order('id')))
    .filter((a) => streetKey(a.street) === key && a.customer_id !== job.customer_id);
  const customerIds = [...new Set(addresses.map((a) => a.customer_id))];
  if (!customerIds.length) return { enabled: true, settings, job, plan: { eligible: [], skipped: [], overflow: 0 } };

  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const [people, jobs, leads, recentOutreach, recentFollowups, offeredRows] = await Promise.all([
    Promise.all(chunk(customerIds, 200).map((ids) => admin.from('customers').select('id,display_name,first_name,phone,email,marketing_opt_out,last_visit_at,archived').in('id', ids).eq('archived', false))),
    Promise.all(chunk(customerIds, 200).map((ids) => admin.from('jobs').select('id,customer_id,customer_token,status,completed_at,address_id').in('customer_id', ids))),
    Promise.all(chunk(customerIds, 200).map((ids) => admin.from('leads').select('customer_id,status').in('customer_id', ids).in('status', OPEN_LEAD))),
    admin.from('outreach_log').select('customer_id').gte('at', since),
    admin.from('estimate_followups').select('keys').gte('at', since),
    admin.from('outreach_log').select('customer_id').eq('dedupe_key', streetDedupe(jobId)),
  ]);
  const flat = (rs) => rs.flatMap((r) => r.data || []);
  const addrBy = new Map();
  for (const a of addresses) if (!addrBy.has(a.customer_id)) addrBy.set(a.customer_id, a);

  const open = new Set(flat(leads).map((l) => l.customer_id));
  const lastJob = new Map();
  for (const j of flat(jobs)) {
    if (OPEN_JOB.includes(j.status)) open.add(j.customer_id);
    if (!['completed', 'closed'].includes(j.status)) continue;
    const cur = lastJob.get(j.customer_id);
    if (!cur || String(j.completed_at || '') > String(cur.completed_at || '')) lastJob.set(j.customer_id, j);
  }
  const candidates = flat(people).map((c) => {
    const j = lastJob.get(c.id);
    return {
      customer_id: c.id, display_name: c.display_name, first_name: c.first_name, phone: c.phone, email: c.email,
      opt_out: !!c.marketing_opt_out, has_open_work: open.has(c.id), last_visit_at: c.last_visit_at || j?.completed_at || null,
      address: { street: addrBy.get(c.id)?.street, city: addrBy.get(c.id)?.city },
      last_job: j ? { id: j.id, token: j.customer_token } : null,
    };
  });
  const blocked = new Set([
    ...(recentOutreach.data || []).map((r) => `c:${r.customer_id}`),
    ...(recentFollowups.data || []).flatMap((r) => r.keys || []),
  ]);
  const plan = planStreetOffers({
    now, tz: settings.timezone || 'America/Chicago', settings, job: { customer_id: job.customer_id, address: job.address },
    candidates, blocked, offered: (offeredRows.data || []).map((r) => r.customer_id),
  });
  return { enabled: true, settings, job, plan };
}

// The list the office sees before sending.
export async function previewStreetOffers(admin, jobId, now = new Date()) {
  const r = await loadStreetPlan(admin, jobId, now);
  if (!r.enabled) return { enabled: false };
  if (r.error) return { enabled: true, error: r.error };
  return {
    enabled: true,
    overflow: r.plan.overflow,
    skipped: r.plan.skipped.map((s) => ({ name: s.name, label: s.label })),
    items: r.plan.eligible.map((c) => ({ customer_id: c.customer_id, name: c.display_name, house: c.house, phone: !!c.phone, email: !!c.email })),
  };
}

// Sends to the customers the office left ticked. Anyone who is no longer eligible (messaged since, opted out) is skipped.
export async function sendStreetOffers({ admin, origin, jobId, customerIds, now = new Date() }) {
  const r = await loadStreetPlan(admin, jobId, now);
  if (!r.enabled) return { enabled: false };
  if (r.error) return { enabled: true, error: r.error };
  const chosen = new Set(customerIds || []);
  const targets = r.plan.eligible.filter((c) => chosen.has(c.customer_id));
  let sent = 0;
  const failed = [];
  for (const c of targets) {
    const link = `${origin}/c/${c.last_job.token}`;
    const m = buildStreetOfferMessages({ business: r.settings.business_name, offer: r.settings.street_offer_text, firstName: c.first_name, link });
    const [sms, email] = await Promise.all([
      c.phone ? sendSms({ to: c.phone, body: m.sms }) : { status: 'skipped', detail: 'No phone number on file.' },
      c.email ? sendEmail({ to: c.email, subject: m.subject, html: m.html, text: m.text }) : { status: 'skipped', detail: 'No email on file.' },
    ]);
    if (sms.status !== 'sent' && email.status !== 'sent') { failed.push({ customer: c.display_name, sms: sms.detail, email: email.detail }); continue; }
    const { error } = await admin.from('outreach_log').insert({
      customer_id: c.customer_id, job_id: jobId, kind: 'street_offer', dedupe_key: streetDedupe(jobId),
      results: { sms: { status: sms.status, detail: sms.detail }, email: { status: email.status, detail: email.detail } },
    });
    if (!error) sent += 1;
  }
  return { enabled: true, sent, failed: failed.slice(0, 10), notChosenOrNoLongerEligible: customerIds.length - targets.length };
}
