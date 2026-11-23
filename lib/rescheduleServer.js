// Server side of customer self-reschedule (#33): the open times for one visit, and moving it. Server only.
import { loadBookingSettings, loadOpenSlots } from './bookingServer.js';
import { findSlot, normalizeBooking } from './booking.js';
import { rescheduleStatus, buildRescheduleMessages, RESCHEDULE_ERRORS } from './reschedule.js';
import { sendSms, sendEmail } from './notify.js';
import { displayPhone } from './phone.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The visit behind a customer's secret link, with what is needed to decide and to message the customer.
export async function loadVisitContext(admin, token) {
  if (!UUID.test(String(token))) return null;
  const { data: v } = await admin.from('job_visits')
    .select('id,job_id,crew_id,status,starts_at,ends_at,duration_minutes,reschedule_count')
    .eq('share_token', token).maybeSingle();
  if (!v) return null;
  const { data: job } = await admin.from('jobs')
    .select('id,job_type,address:addresses(street),customer:customers(first_name,phone,email)')
    .eq('id', v.job_id).maybeSingle();
  return { visit: v, job };
}

// What the visit page needs to show the "need a different time?" part: whether it is allowed, and if not, why.
export async function rescheduleFor(admin, ctx, settings, now = new Date()) {
  return rescheduleStatus({ visit: ctx.visit, jobType: ctx.job?.job_type, settings, now });
}

// The open times this visit could move to (its own time and its crew's are not counted as busy, and its current time is left out).
export async function rescheduleOptions(admin, token, now = new Date()) {
  const ctx = await loadVisitContext(admin, token);
  if (!ctx) return { error: 'Not found.', status: 404 };
  const settings = await loadBookingSettings(admin);
  const st = rescheduleStatus({ visit: ctx.visit, jobType: ctx.job?.job_type, settings, now });
  if (!st.allowed) return { error: 'This visit cannot be moved online. Please call us.', status: 409, reason: st.reason };
  const open = await loadOpenSlots(admin, settings, now, ctx.visit);
  const current = Date.parse(ctx.visit.starts_at);
  const days = open.days
    .map((d) => ({ ...d, slots: d.slots.filter((s) => Date.parse(s.start) !== current) }))
    .filter((d) => d.slots.length);
  return { tz: open.tz, days, current: { start: ctx.visit.starts_at, end: ctx.visit.ends_at } };
}

// Moves the visit to the chosen time. Returns { ok, start, end } or { error, status, code }.
export async function rescheduleVisit({ admin, token, startIso, origin, now = new Date() }) {
  const ctx = await loadVisitContext(admin, token);
  if (!ctx) return { error: 'Not found.', status: 404, code: 'NOT_FOUND' };
  const settings = await loadBookingSettings(admin);
  const st = rescheduleStatus({ visit: ctx.visit, jobType: ctx.job?.job_type, settings, now });
  if (!st.allowed) return { error: 'This visit cannot be moved online. Please call us.', status: 409, code: 'NOT_ALLOWED' };

  // The time must be one the booking rules offer right now.
  const open = await loadOpenSlots(admin, settings, now, ctx.visit);
  const slot = findSlot(open.days, startIso);
  if (!slot) return { error: 'That time is no longer open. Please pick another.', status: 409, code: 'SLOT_TAKEN' };

  const { data, error } = await admin.rpc('self_reschedule_visit', { p_token: token, p_starts_at: slot.start });
  if (error) {
    const code = Object.keys(RESCHEDULE_ERRORS).find((k) => (error.message || '').includes(k));
    if (code) return { error: RESCHEDULE_ERRORS[code][1], status: RESCHEDULE_ERRORS[code][0], code };
    console.error('self_reschedule_visit failed:', error.message);
    return { error: 'Something went wrong. Please try again.', status: 500, code: 'FAILED' };
  }

  const end = data?.ends_at || slot.end;
  await sendRescheduleConfirmation({ admin, ctx, settings, startIso: slot.start, endIso: end, link: `${origin}/v/${token}` });
  return { ok: true, start: slot.start, end };
}

// Texts and emails the new time. Never throws and never undoes the move; logged on the job only when something was delivered.
async function sendRescheduleConfirmation({ admin, ctx, settings, startIso, endIso, link }) {
  try {
    const c = ctx.job?.customer || {};
    const tz = normalizeBooking(settings).tz;
    const msgs = buildRescheduleMessages({
      business: settings.business_name, firstName: c.first_name, startIso, endIso, tz,
      street: ctx.job?.address?.street, link, phone: displayPhone(settings.phone),
    });
    const [sms, email] = await Promise.all([
      c.phone ? sendSms({ to: c.phone, body: msgs.sms }) : { status: 'skipped', detail: 'No phone number.' },
      c.email ? sendEmail({ to: c.email, subject: msgs.subject, html: msgs.html, text: msgs.text }) : { status: 'skipped', detail: 'No email.' },
    ]);
    if (sms.status === 'sent' || email.status === 'sent') {
      await admin.from('job_events').insert({
        job_id: ctx.visit.job_id, kind: 'reschedule_confirmation_sent',
        details: { sms: { status: sms.status }, email: { status: email.status } },
      });
    }
  } catch (e) {
    console.error('reschedule confirmation failed:', e.message);
  }
}
