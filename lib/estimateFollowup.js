// Gentle nudges for estimates that were sent and not answered (push 1A, #11).
// This file decides who gets a nudge and what it says; lib/estimateFollowupServer.js loads the data and sends.
// Pure, so it can be tested. Dates are 'YYYY-MM-DD' in the business time zone.
import { addDays, dateInTz, renderTemplate } from './outreach.js';

export const FOLLOWUP_WINDOW_DAYS = 3; // a nudge is sent in the three days after it falls due, so a missed day is not lost
export const DEFAULT_FOLLOWUP_DAYS = [2, 5, 10];

// "2, 5, 10" -> [2, 5, 10]. Whole days from 1 to 60, no repeats, in order, at most 6.
export function parseFollowupDays(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[,\s]+/);
  const days = [...new Set(raw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 60))].sort((a, b) => a - b);
  return days.slice(0, 6);
}

const digits = (s) => String(s ?? '').replace(/\D/g, '');

// Everything that identifies the person a message goes to, so "one message per person per day" holds even when the
// same person is a customer record in one place and a typed-in lead in another.
export function contactKeys({ customer_id, phone, email } = {}) {
  const keys = [];
  if (customer_id) keys.push(`c:${customer_id}`);
  const p = digits(phone).slice(-10);
  if (p.length === 10) keys.push(`p:${p}`);
  const e = String(email ?? '').trim().toLowerCase();
  if (e) keys.push(`e:${e}`);
  return keys;
}

// estimates: [{ id, status, sent_at, first_viewed_at, expires_at, followups_paused, share_token, customer_id, name, first_name,
//               phone, email, opt_out, closed }]  (closed = the lead was lost or the job was cancelled)
// logged: Set or array of `${estimate_id}|${dedupe_key}` already delivered
// blocked: Set of contact keys that already got a message today (from outreach or an earlier run)
// Returns at most one nudge per estimate and per person.
export function planEstimateFollowups({ now = new Date(), tz = 'America/Chicago', settings = {}, estimates = [], logged = [], blocked = [] }) {
  if (!settings.estimate_followup_enabled) return [];
  const days = parseFollowupDays(settings.estimate_followup_days?.length ? settings.estimate_followup_days : DEFAULT_FOLLOWUP_DAYS);
  if (!days.length) return [];
  const today = dateInTz(now, tz);
  const done = logged instanceof Set ? logged : new Set(logged);
  const taken = new Set(blocked instanceof Set ? [...blocked] : blocked);
  const out = [];

  for (const e of estimates) {
    if (e.status !== 'sent' || e.followups_paused || e.closed || e.opt_out) continue;
    if (!e.sent_at || !e.share_token) continue;
    if (!e.phone && !e.email) continue;
    if (e.expires_at && new Date(e.expires_at) <= now) continue; // an expired estimate is not nudged
    const keys = contactKeys(e);
    if (keys.some((k) => taken.has(k))) continue;

    const sentDay = dateInTz(e.sent_at, tz);
    let pick = null;
    days.forEach((n, i) => {
      const start = addDays(sentDay, n);
      if (today < start || today > addDays(start, FOLLOWUP_WINDOW_DAYS)) return;
      const dedupe = `step:${i + 1}:${sentDay}`;
      if (!done.has(`${e.id}|${dedupe}`)) pick = { step: i + 1, dedupe, of: days.length, after: n }; // the latest due step wins
    });
    if (!pick) continue;

    keys.forEach((k) => taken.add(k));
    out.push({
      estimate_id: e.id, step: pick.step, of: pick.of, dedupe: pick.dedupe, opened: !!e.first_viewed_at,
      detail: `step ${pick.step} of ${pick.of}, ${pick.after} days after it was sent, ${e.first_viewed_at ? 'opened' : 'not opened'}`,
      name: e.name, first_name: e.first_name, phone: e.phone, email: e.email, token: e.share_token, keys,
    });
  }
  return out;
}

// ------------------------------------------------------------------ wording
const DEFAULTS = {
  unopened: 'Hi {first}, just checking that you received your estimate from {business}. You can view and approve it here: {link}',
  opened: 'Hi {first}, thanks for taking a look at your estimate from {business}. If you have any questions, or you are ready to go ahead, you can approve it here: {link}',
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// opened: whether the customer has opened the estimate link; custom: the owner's own wording for that case (may be empty)
export function buildFollowupMessages({ opened = false, custom = '', business, firstName, link }) {
  const biz = String(business || '').trim() || 'us';
  const first = String(firstName || '').trim() || 'there';
  const base = renderTemplate(String(custom || '').trim() || DEFAULTS[opened ? 'opened' : 'unopened'], { first, business: biz, link });
  const subject = `Your estimate from ${biz}`;
  const sms = `${base} Reply STOP to opt out.`;
  const text = `${base}\n\nTo stop these reminders, open the link above and choose "Stop reminders about this estimate".\n\n${biz}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430;max-width:520px">
<p>${esc(base.replace(link, '')).trim()}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">View your estimate</a></p>
<p style="color:#6b7686;font-size:14px">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>
<p style="color:#6b7686;font-size:13px">To stop these reminders, open the link and choose "Stop reminders about this estimate".</p>
<p>${esc(biz)}</p></div>`;
  return { sms, subject, text, html };
}
