// Runs the slow-day offers (#17). Server only. Called by runOutreach (lib/outreachServer.js) on the same daily run.
// findSlowDays and planSlowDayOffers (lib/slowDay.js) decide which days and who; this loads the data, sends, and records
// what was delivered. An offer is saved and logged only when a text or email actually went out, so a missing Twilio or Resend
// setup is retried the next day instead of leaving an unused offer behind.
import { sendSms, sendEmail } from './notify.js';
import { loadScheduleLoad } from './bookingServer.js';
import { normalizeBooking } from './booking.js';
import { contactKeys } from './estimateFollowup.js';
import { dateInTz } from './outreach.js';
import { normalizeSlowDay, findSlowDays, planSlowDayOffers, buildSlowDayMessages, daysPhrase, slowDayDedupe, SLOWDAY_SKIP } from './slowDay.js';

const REPEAT_DAYS = 14; // nobody gets a slow-day offer more than once in two weeks

// inputs: what loadOutreachInputs returned (settings row, customers). alsoBlocked: contact keys already messaged by the rest of today's run.
export async function runSlowDayOffers({ admin, origin, inputs, dryRun = false, now = new Date(), alsoBlocked = [] }) {
  const { settings, customers } = inputs;
  if (!settings?.slowday_enabled) return { due: 0, sent: 0, skipped: [], items: [], reached: [] };

  const cfg = normalizeBooking(settings);
  const { busy, capacity } = await loadScheduleLoad(admin, settings, now);
  const slow = findSlowDays({ now, settings, busy, capacity });
  if (!slow.length) return { due: 0, sent: 0, skipped: [], items: [], reached: [], slowDays: [] };

  const sd = normalizeSlowDay(settings);
  const sinceDay = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const sinceLately = new Date(now.getTime() - REPEAT_DAYS * 86400000).toISOString();
  const [recent, followups, lately] = await Promise.all([
    admin.from('outreach_log').select('customer_id').gte('at', sinceDay),
    admin.from('estimate_followups').select('keys').gte('at', sinceDay),
    admin.from('outreach_log').select('customer_id').eq('kind', 'slowday_offer').gte('at', sinceLately),
  ]);
  const blocked = new Set([
    ...alsoBlocked,
    ...(recent.data || []).map((r) => `c:${r.customer_id}`),
    ...(followups.data || []).flatMap((r) => r.keys || []),
  ]);
  const plan = planSlowDayOffers({
    now, tz: cfg.tz, settings, customers, blocked, offeredLately: (lately.data || []).map((r) => r.customer_id),
  });
  const dates = slow.map((d) => d.date);
  const expiresOn = dates[dates.length - 1];

  if (dryRun) {
    const items = plan.eligible.map((c) => ({ customer: c.display_name, kind: 'Slow-day offer', detail: `${sd.percent}% off for ${daysPhrase(dates)}`, phone: !!c.phone, email: !!c.email }));
    return { due: plan.eligible.length, sent: 0, skipped: [], items, reached: [], slowDays: slow };
  }

  let sent = 0;
  const skipped = [];
  const reached = [];
  for (const c of plan.eligible) {
    // The offer row is made first so its link exists; it is removed again if nothing could be delivered.
    const { data: offer, error: oerr } = await admin.from('slowday_offers')
      .insert({ customer_id: c.id, percent: sd.percent, dates, expires_on: expiresOn })
      .select('id,token').single();
    if (oerr || !offer) { skipped.push({ customer: c.display_name, sms: 'Could not save the offer.', email: '' }); continue; }
    const link = `${origin}/book?offer=${offer.token}`;
    const careLink = `${origin}/c/${c.last_job.token}`;
    const m = buildSlowDayMessages({
      business: settings.business_name, custom: settings.slowday_message, firstName: c.first_name, percent: sd.percent, dates, link, careLink,
    });
    const [sms, email] = await Promise.all([
      c.phone ? sendSms({ to: c.phone, body: m.sms }) : { status: 'skipped', detail: 'No phone number on file.' },
      c.email ? sendEmail({ to: c.email, subject: m.subject, html: m.html, text: m.text }) : { status: 'skipped', detail: 'No email on file.' },
    ]);
    if (sms.status !== 'sent' && email.status !== 'sent') {
      await admin.from('slowday_offers').delete().eq('id', offer.id);
      skipped.push({ customer: c.display_name, sms: sms.detail, email: email.detail });
      continue;
    }
    const { error } = await admin.from('outreach_log').insert({
      customer_id: c.id, job_id: c.last_job.id, kind: 'slowday_offer', dedupe_key: slowDayDedupe(offer.token),
      results: { sms: { status: sms.status, detail: sms.detail }, email: { status: email.status, detail: email.detail } },
    });
    if (!error) { sent += 1; reached.push(...contactKeys({ customer_id: c.id, phone: c.phone, email: c.email })); }
  }
  return { due: plan.eligible.length, sent, skipped: skipped.slice(0, 20), items: [], reached, slowDays: slow };
}

// ------------------------------------------------------------------ the booking page side
// The offer behind a customer's link, or null. Used by the booking page and the booking route.
export async function loadOffer(admin, token) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(token || ''))) return null;
  const { data } = await admin.from('slowday_offers').select('id,token,customer_id,percent,dates,expires_on,used_at,lead_id').eq('token', token).maybeSingle();
  return data || null;
}

// Marks the offer used by this booking. Only the first caller wins, so one link can never be used twice.
export async function claimOffer(admin, offerId) {
  const { data } = await admin.from('slowday_offers').update({ used_at: new Date().toISOString() }).eq('id', offerId).is('used_at', null).select('id');
  return (data || []).length === 1;
}
export async function releaseOffer(admin, offerId) {
  await admin.from('slowday_offers').update({ used_at: null, lead_id: null }).eq('id', offerId);
}

export { SLOWDAY_SKIP, dateInTz };
