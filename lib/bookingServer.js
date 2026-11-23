// Server-side pieces of booking: the settings it needs, the open slots, booking a slot, and the confirmation message.
// Server only (uses the service-role client passed in by the route).
import { computeOpenSlots, normalizeBooking, fmtSlotFull, ACTIVE_VISIT } from './booking.js';
import { buildBookingMessages } from './bookingMessages.js';
import { sendSms, sendEmail } from './notify.js';
import { displayPhone } from './phone.js';

export const BOOKING_SETTINGS_COLUMNS = [
  'business_name', 'phone', 'email', 'logo_path', 'timezone', 'job_minimum',
  'booking_enabled', 'booking_after_sign', 'booking_days', 'booking_day_start', 'booking_day_end',
  'booking_slot_minutes', 'booking_gap_minutes', 'booking_crews', 'booking_notice_hours', 'booking_window_days', 'booking_capacity_enabled',
  'reschedule_enabled', 'reschedule_notice_hours', 'reschedule_max',
].join(',');

export async function loadBookingSettings(admin) {
  const { data } = await admin.from('settings').select(BOOKING_SETTINGS_COLUMNS).eq('id', 1).maybeSingle();
  return data || {};
}

// The visits already on the schedule (and, in capacity mode, the techs and their time off): what the open-slot rule works from.
// exclude: { id, crew_id } leaves one visit (and its crew) out, for a customer moving their own visit.
export async function loadScheduleLoad(admin, settings, now = new Date(), exclude = null) {
  const cfg = normalizeBooking(settings);
  const until = new Date(now.getTime() + (cfg.windowDays + 2) * 86400000).toISOString();
  const { data } = await admin
    .from('job_visits')
    .select('id,crew_id,starts_at,ends_at')
    .in('status', ACTIVE_VISIT)
    .lt('starts_at', until)
    .gt('ends_at', now.toISOString())
    .limit(5000);
  // Capacity mode: the crews on a given day are the active techs who are not off that day.
  let capacity = null;
  if (settings.booking_capacity_enabled) {
    const from = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    const [{ data: techs }, { data: off }] = await Promise.all([
      admin.from('staff_users').select('id').eq('role', 'tech').eq('active', true),
      admin.from('time_off').select('staff_id,starts_on,ends_on').gte('ends_on', from).limit(2000),
    ]);
    capacity = { techIds: (techs || []).map((t) => t.id), timeOff: off || [] };
  }
  const busy = (data || []).filter((r) => !exclude || (r.id !== exclude.id && !(exclude.crew_id && r.crew_id === exclude.crew_id)));
  return { busy, capacity };
}

// Every slot still open, from the visits already on the schedule.
export async function loadOpenSlots(admin, settings, now = new Date(), exclude = null) {
  const { busy, capacity } = await loadScheduleLoad(admin, settings, now, exclude);
  return computeOpenSlots({ now, settings, busy, capacity });
}

const BOOK_ERRORS = {
  SLOT_TAKEN: [409, 'That time was just taken. Please pick another.'],
  LEAD_NOT_READY: [409, 'This booking cannot be scheduled online. Please contact us.'],
  LEAD_ALREADY_BOOKED: [409, 'This is already booked.'],
  LEAD_NEEDS_ADDRESS: [400, 'We need the service address before we can book a time.'],
  LEAD_NEEDS_NAME: [400, 'We need your name before we can book a time.'],
  LEAD_NOT_FOUND: [404, 'Not found.'],
};

// Books the lead into the slot. Returns { jobId } or { error, code, status }.
export async function bookSlot(admin, leadId, startIso) {
  const { data, error } = await admin.rpc('self_book_slot', { p_lead: leadId, p_starts_at: startIso });
  if (error) {
    const code = Object.keys(BOOK_ERRORS).find((k) => (error.message || '').includes(k));
    if (code) return { error: BOOK_ERRORS[code][1], code, status: BOOK_ERRORS[code][0] };
    console.error('self_book_slot failed:', error.message);
    return { error: 'Something went wrong. Please try again.', code: 'FAILED', status: 500 };
  }
  return { jobId: data };
}

// Texts and emails "you're booked". Never throws and never blocks the booking: the booking is already saved.
// Logged on the job only when something was actually delivered.
export async function sendBookingConfirmation({ admin, jobId, settings, lead, startIso, endIso, link }) {
  try {
    const cfg = normalizeBooking(settings);
    const when = fmtSlotFull(startIso, endIso, cfg.tz);
    const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.company_name || '';
    const msgs = buildBookingMessages({
      business: settings.business_name, customerName: name, when, street: lead.street,
      link, phone: displayPhone(settings.phone),
    });
    const [sms, email] = await Promise.all([
      lead.phone ? sendSms({ to: lead.phone, body: msgs.sms }) : { status: 'skipped', detail: 'No phone number.' },
      lead.email ? sendEmail({ to: lead.email, subject: msgs.subject, html: msgs.html, text: msgs.text }) : { status: 'skipped', detail: 'No email.' },
    ]);
    if (sms.status === 'sent' || email.status === 'sent') {
      await admin.from('job_events').insert({
        job_id: jobId,
        kind: 'booking_confirmation_sent',
        details: { sms: { status: sms.status }, email: { status: email.status } },
      });
    }
    return { sms, email };
  } catch (e) {
    console.error('booking confirmation failed:', e.message);
    return null;
  }
}

// The estimate behind a secret link, if its customer may still pick a time: approved, still a lead (no work order yet),
// with an address, and picking a time online is allowed (the "after signing" switch, or the estimate came from the
// booking page, which has its own fall-back for a time that was just taken).
// Returns { est, lead, settings } or { error, status }.
export async function loadSchedulable(admin, token) {
  const { data: est } = await admin.from('estimates').select('id,job_id,lead_id,status').eq('share_token', token).maybeSingle();
  if (!est || est.status !== 'approved' || !est.lead_id || est.job_id) {
    return { error: 'This estimate cannot be scheduled online. Please contact us.', status: 409 };
  }
  const [{ data: lead }, settings] = await Promise.all([
    admin.from('leads').select('id,status,first_name,last_name,company_name,phone,email,street,intake').eq('id', est.lead_id).maybeSingle(),
    loadBookingSettings(admin),
  ]);
  if (!lead) return { error: 'Not found.', status: 404 };
  if (lead.status === 'booked') return { error: 'This is already scheduled.', status: 409 };
  if (lead.status !== 'accepted') return { error: 'This estimate cannot be scheduled online. Please contact us.', status: 409 };
  if (!String(lead.street || '').trim()) return { error: 'We need the service address before a time can be booked. Please contact us.', status: 409 };
  if (settings.booking_after_sign === false && !lead.intake?.booking) {
    return { error: 'Please contact us to schedule.', status: 403 };
  }
  return { est, lead, settings };
}
