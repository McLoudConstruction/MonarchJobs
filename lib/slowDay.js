// Slow-day pricing (push 2C, #17). Finds the days that are mostly empty and offers past carpet customers a percent off for
// booking one of them. This file decides which days are slow, who is offered, what the message says and what the discount is;
// lib/slowDayServer.js loads the data and sends. Pure, so it can be tested.
import { computeOpenSlots, normalizeBooking, fmtSlotDayShort, addDaysStr } from './booking.js';
import { contactKeys } from './estimateFollowup.js';
import { dateInTz } from './outreach.js';

export const DEFAULT_SLOWDAY = {
  slowday_percent: 10,
  slowday_look_ahead_days: 7,
  slowday_min_notice_hours: 48,
  slowday_open_share: 60,
  slowday_max_dates: 3,
  slowday_max_per_day: 10,
  slowday_quiet_days: 60,
};

const num = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function normalizeSlowDay(raw = {}) {
  const d = DEFAULT_SLOWDAY;
  return {
    enabled: raw.slowday_enabled === true,
    percent: num(raw.slowday_percent, 1, 50, d.slowday_percent),
    lookAhead: num(raw.slowday_look_ahead_days, 1, 30, d.slowday_look_ahead_days),
    minNotice: num(raw.slowday_min_notice_hours, 0, 336, d.slowday_min_notice_hours),
    openShare: num(raw.slowday_open_share, 10, 100, d.slowday_open_share),
    maxDates: num(raw.slowday_max_dates, 1, 7, d.slowday_max_dates),
    maxPerDay: num(raw.slowday_max_per_day, 1, 50, d.slowday_max_per_day),
    quietDays: num(raw.slowday_quiet_days, 0, 730, d.slowday_quiet_days),
  };
}

// The slow days among the next few: a booking day where at least `openShare` percent of the day's appointment times are still open.
// Days sooner than the cutoff (`minNotice` hours) are never offered, so there is time to plan. Returns at most `maxDates`,
// the emptiest first, then in date order. busy: active visits [{ starts_at, ends_at }]. capacity: as for computeOpenSlots.
export function findSlowDays({ now = new Date(), settings = {}, busy = [], capacity = null } = {}) {
  const sd = normalizeSlowDay(settings);
  const cfg = normalizeBooking(settings);
  if (!cfg.starts.length) return [];
  // The offer cutoff can only be later than the normal booking notice, never earlier.
  const noticeHours = Math.max(cfg.notice, sd.minNotice);
  const open = computeOpenSlots({
    now, busy, capacity,
    settings: { ...settings, booking_notice_hours: noticeHours, booking_window_days: Math.min(cfg.windowDays, Math.ceil(noticeHours / 24) + sd.lookAhead) },
  });
  const total = cfg.starts.length;
  const today = dateInTz(now, cfg.tz);
  const last = addDaysStr(today, Math.min(cfg.windowDays, Math.ceil(noticeHours / 24) + sd.lookAhead));
  const slow = [];
  for (const day of open.days) {
    if (day.date > last) continue;
    const share = Math.round((day.slots.length / total) * 100);
    if (day.slots.length >= 1 && share >= sd.openShare) slow.push({ date: day.date, open: day.slots.length, total, share });
  }
  return slow
    .sort((a, b) => b.share - a.share || a.date.localeCompare(b.date))
    .slice(0, sd.maxDates)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const SLOWDAY_SKIP = {
  opted_out: 'Asked to stop reminders',
  open_work: 'Has open work with us',
  no_contact: 'No phone or email',
  recent: 'Cleaned very recently',
  messaged_today: 'Already got a message today',
  offered_lately: 'Already got a slow-day offer lately',
};

// customers: as built by loadOutreachInputs ({ id, display_name, first_name, phone, email, opt_out, has_open_work, last_visit_at, last_job: { id, token, type } | null }).
// blocked: contact keys that already got a message today. offeredLately: customer ids that got a slow-day offer in the last 14 days.
// Carpet customers only. The ones due for a cleaning longest ago come first, up to the daily cap.
export function planSlowDayOffers({ now = new Date(), tz = 'America/Chicago', settings = {}, customers = [], blocked = [], offeredLately = [] }) {
  const sd = normalizeSlowDay(settings);
  const blockedSet = blocked instanceof Set ? blocked : new Set(blocked);
  const lately = offeredLately instanceof Set ? offeredLately : new Set(offeredLately);
  const today = dateInTz(now, tz);
  const eligible = [];
  const skipped = [];
  for (const c of customers) {
    if (!c.last_job?.token || c.last_job.type !== 'floor_cleaning') continue;
    const skip = (reason) => skipped.push({ customer_id: c.id, name: c.display_name, reason, label: SLOWDAY_SKIP[reason] });
    if (c.opt_out) { skip('opted_out'); continue; }
    if (!c.phone && !c.email) { skip('no_contact'); continue; }
    if (c.has_open_work) { skip('open_work'); continue; }
    if (lately.has(c.id)) { skip('offered_lately'); continue; }
    if (contactKeys({ customer_id: c.id, phone: c.phone, email: c.email }).some((k) => blockedSet.has(k))) { skip('messaged_today'); continue; }
    if (sd.quietDays > 0 && c.last_visit_at) {
      const days = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${dateInTz(c.last_visit_at, tz)}T12:00:00Z`)) / 86400000;
      if (days < sd.quietDays) { skip('recent'); continue; }
    }
    eligible.push(c);
  }
  eligible.sort((a, b) => String(a.last_visit_at || '').localeCompare(String(b.last_visit_at || '')) || String(a.display_name).localeCompare(String(b.display_name)));
  return { eligible: eligible.slice(0, sd.maxPerDay), skipped, overflow: Math.max(0, eligible.length - sd.maxPerDay) };
}

// ------------------------------------------------------------------ the discount
// The discount in cents for a booking: the percent of the total, never taking the total below the job minimum.
// totalCents is the price with the job minimum already applied. If the price is already at the minimum there is nothing to take off.
export function slowDayDiscountCents(totalCents, minimumCents, percent) {
  const total = Math.max(0, Math.round(Number(totalCents) || 0));
  const min = Math.max(0, Math.round(Number(minimumCents) || 0));
  const pct = num(percent, 0, 50, 0);
  const wanted = Math.round((total * pct) / 100);
  return Math.max(0, Math.min(wanted, total - min));
}

// The estimate line that carries the discount (a negative custom line), or null when there is nothing to take off.
export function slowDayDiscountLine({ totalCents, minimumCents, percent, sortOrder = 99 }) {
  const cents = slowDayDiscountCents(totalCents, minimumCents, percent);
  if (cents <= 0) return null;
  return {
    price_item_id: null,
    description: `Slow-day offer (${num(percent, 1, 50, 0)}% off)`,
    unit: 'flat',
    quantity: 1,
    unit_price: -cents / 100,
    is_custom: true,
    sort_order: sortOrder,
  };
}

// An offer row is good when it has not been used and its last day has not passed. Dates are 'YYYY-MM-DD' in the business time zone.
export function offerStatus(offer, { now = new Date(), tz = 'America/Chicago' } = {}) {
  if (!offer) return { ok: false, reason: 'not_found' };
  if (offer.used_at) return { ok: false, reason: 'used' };
  if (String(offer.expires_on) < dateInTz(now, tz)) return { ok: false, reason: 'expired' };
  return { ok: true };
}

export const OFFER_PROBLEMS = {
  not_found: 'This offer link is not valid.',
  used: 'This offer has already been used.',
  expired: 'This offer has ended.',
};

// Keeps only the open slot days the offer covers.
export function limitDaysToOffer(days, dates) {
  const ok = new Set((dates || []).map(String));
  return (days || []).filter((d) => ok.has(d.date));
}

// ------------------------------------------------------------------ wording
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// "Tue, Nov 25", "Tue, Nov 25 and Wed, Nov 26", "Tue, Nov 25, Wed, Nov 26 and Thu, Nov 27"
export function daysPhrase(dates) {
  const list = (dates || []).map((d) => fmtSlotDayShort(d));
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

const DEFAULT_OFFER = 'Hi {first}, {business} has openings on {days}. Book a carpet cleaning for one of those days and get {percent}% off: {link}';

export function renderOffer(template, vars) {
  return String(template).replace(/\{(first|business|link|percent|days)\}/g, (_, k) => vars[k] ?? '');
}

// careLink: the customer's care page, which has the "Stop reminders" button. link: the booking page with the offer.
export function buildSlowDayMessages({ business, custom = '', firstName, percent, dates, link, careLink }) {
  const named = String(business || '').trim();
  const biz = named || 'we';
  const first = String(firstName || '').trim() || 'there';
  const base = renderOffer(String(custom || '').trim() || DEFAULT_OFFER, { first, business: biz, link, percent: String(percent), days: daysPhrase(dates) });
  const sms = `${base} Reply STOP to opt out.`;
  const subject = `${percent}% off a carpet cleaning this week${named ? ` with ${named}` : ''}`;
  const text = `${base}\n\nTo stop these messages, open ${careLink} and choose "Stop reminders".\n\n${named}`.trim();
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430;max-width:520px">
<p>${esc(base.replace(link, '')).trim()}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Book with ${esc(percent)}% off</a></p>
<p style="color:#6b7686;font-size:14px">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>
<p style="color:#6b7686;font-size:13px">To stop these messages, <a href="${esc(careLink)}">open this page</a> and choose "Stop reminders".</p>
<p>${esc(named)}</p></div>`;
  return { sms, subject, text, html };
}

export const slowDayDedupe = (token) => `slowday:${token}`;
