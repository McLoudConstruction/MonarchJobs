// Customer self-reschedule (push 2C, #33). A customer opens the link from their text, picks a new open time, and the visit moves.
// Pure, so it can be tested. lib/rescheduleServer.js loads the data and talks to the database.
// Never includes staff names, gate codes or notes.
import { fmtSlotFull } from './booking.js';

export const DEFAULT_RESCHEDULE = { reschedule_enabled: false, reschedule_notice_hours: 24, reschedule_max: 2 };

const clamp = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function normalizeReschedule(raw = {}) {
  return {
    enabled: raw.reschedule_enabled === true,
    noticeHours: clamp(raw.reschedule_notice_hours, 0, 336, DEFAULT_RESCHEDULE.reschedule_notice_hours),
    max: clamp(raw.reschedule_max, 1, 10, DEFAULT_RESCHEDULE.reschedule_max),
  };
}

// Whether this customer may pick a new time for this visit, and if not, why. Carpet cleaning only: a restoration visit
// (water, mold) is never moved by the customer on their own.
// visit: { status, starts_at, reschedule_count }, jobType: the job's type, settings: the settings row.
export function rescheduleStatus({ visit, jobType, settings = {}, now = new Date() }) {
  const cfg = normalizeReschedule(settings);
  if (!cfg.enabled) return { allowed: false, reason: 'off' };
  if (!visit || visit.status !== 'scheduled') return { allowed: false, reason: 'not_scheduled' };
  if (jobType !== 'floor_cleaning') return { allowed: false, reason: 'type' };
  const start = Date.parse(visit.starts_at);
  if (!Number.isFinite(start)) return { allowed: false, reason: 'not_scheduled' };
  if (start < now.getTime() + cfg.noticeHours * 3600000) return { allowed: false, reason: 'too_late', hours: cfg.noticeHours };
  if ((Number(visit.reschedule_count) || 0) >= cfg.max) return { allowed: false, reason: 'limit' };
  return { allowed: true };
}

// What the visit page says when the customer cannot pick a time themselves. Empty when there is nothing worth saying.
export function rescheduleNote(status, phone = '') {
  const call = phone ? ` Please call us at ${phone}.` : ' Please contact us.';
  if (status.allowed) return '';
  if (status.reason === 'too_late') return `This visit is coming up soon, so the time can only be changed by us.${call}`;
  if (status.reason === 'limit') return `This visit has already been moved the most times we allow online.${call}`;
  return '';
}

// Errors from the database function -> [http status, what the customer sees].
export const RESCHEDULE_ERRORS = {
  SLOT_TAKEN: [409, 'That time was just taken. Please pick another.'],
  TOO_LATE: [409, 'This visit is coming up soon, so the time can only be changed by calling us.'],
  LIMIT_REACHED: [409, 'This visit has already been moved the most times we allow online. Please call us.'],
  NOT_SCHEDULED: [409, 'This visit can no longer be moved online. Please call us.'],
  NOT_ALLOWED_TYPE: [409, 'This visit can only be moved by calling us.'],
  RESCHEDULE_OFF: [403, 'Changing the time online is not available. Please call us.'],
  SAME_TIME: [400, 'That is the time you already have. Please pick a different one.'],
  NOT_FOUND: [404, 'Not found.'],
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The confirmation after the customer moves a visit. It answers their own action, so like the booking confirmation it carries no
// STOP line. street is the job street (no unit, gate code or notes).
export function buildRescheduleMessages({ business, firstName, startIso, endIso, tz, street, link, phone }) {
  const biz = String(business || '').trim() || 'us';
  const hello = String(firstName || '').trim() ? `Hi ${String(firstName).trim()},` : 'Hi,';
  const when = fmtSlotFull(startIso, endIso, tz);
  const where = street ? ` at ${street}` : '';
  const change = phone ? ` Need another change? Open ${link} or call ${phone}.` : ` Need another change? Open ${link}.`;
  const sms = `${hello} your visit with ${biz} is now ${when}${where}.${change}`;
  const subject = `Your visit with ${biz} is now ${when}`;
  const text = `${hello}\n\nYour visit with ${biz} has been moved.\n\nNew time: ${when}${street ? `\nWhere: ${street}` : ''}\n\n${change.trim()}\n\n${biz}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430;max-width:520px">
<p>${esc(hello)}</p>
<p>Your visit with <strong>${esc(biz)}</strong> has been moved.</p>
<p><strong>New time:</strong> ${esc(when)}${street ? `<br><strong>Where:</strong> ${esc(street)}` : ''}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">View your visit</a></p>
${phone ? `<p style="color:#6b7686;font-size:14px">Questions? Call ${esc(phone)}.</p>` : ''}
<p>${esc(biz)}</p></div>`;
  return { sms, subject, text, html };
}

// Busy spans for the slot list when this visit moves: everything on the schedule except this visit and its own crew.
// rows: [{ id, crew_id, starts_at, ends_at }]
export function busyExcludingVisit(rows, visit) {
  return (rows || []).filter((r) => r.id !== visit.id && !(visit.crew_id && r.crew_id === visit.crew_id));
}
