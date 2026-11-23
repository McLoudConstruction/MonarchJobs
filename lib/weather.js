// Weather alerts (push 2C): the storm trigger (#25) and the freeze warning.
// Pure, so it can be tested. lib/weatherServer.js asks the National Weather Service, saves the alerts and sends.
import { contactKeys } from './estimateFollowup.js';
import { dateInTz, renderTemplate } from './outreach.js';

// Warnings that mean storm damage or a rush of calls. The owner ticks which of these count (Settings > Outreach).
export const STORM_EVENT_CHOICES = [
  'Tornado Warning',
  'Severe Thunderstorm Warning',
  'Flash Flood Warning',
  'Flood Warning',
  'Hurricane Warning',
  'Tropical Storm Warning',
  'Winter Storm Warning',
  'Ice Storm Warning',
  'Blizzard Warning',
  'High Wind Warning',
];

// Cold that can freeze water in equipment left outside. Watches are not included: a warning means it is expected.
export const FREEZE_EVENTS = ['Freeze Warning', 'Hard Freeze Warning', 'Extreme Cold Warning'];

export const DEFAULT_FREEZE_PRECAUTIONS =
  'Bring in or cover anything that holds water and can freeze: hoses, pumps, water lines and fittings. Keep batteries and electronics out of the cold. Drain or protect equipment that stays outside.';

// "37.2, -93.3" -> { lat, lng }. A 5-digit ZIP -> { zip }. Anything else -> null.
export function parseLocation(text) {
  const s = String(text ?? '').trim();
  const zip = /^(\d{5})(-\d{4})?$/.exec(s);
  if (zip) return { zip: zip[1] };
  const pair = /^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(s);
  if (pair) {
    const lat = Number(pair[1]);
    const lng = Number(pair[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }
  return null;
}

// 'freeze' | 'storm' | null for an alert's event name, given what the owner turned on.
export function classifyEvent(event, settings = {}) {
  const e = String(event ?? '').trim();
  if (settings.freeze_enabled && FREEZE_EVENTS.includes(e)) return 'freeze';
  const chosen = Array.isArray(settings.storm_events) && settings.storm_events.length ? settings.storm_events : STORM_EVENT_CHOICES;
  if (settings.storm_enabled && chosen.includes(e) && STORM_EVENT_CHOICES.includes(e)) return 'storm';
  return null;
}

const isoOrNull = (v) => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// The weather service's answer for a point ({ features: [{ properties }] }) -> the alerts that matter, one per alert id.
// Tests, exercises and cancellations are left out.
export function parseNwsAlerts(json, settings = {}) {
  const out = [];
  const seen = new Set();
  for (const f of Array.isArray(json?.features) ? json.features : []) {
    const p = f?.properties || {};
    const id = String(p.id || f?.id || '').trim();
    if (!id || seen.has(id)) continue;
    if (p.status && p.status !== 'Actual') continue;
    if (p.messageType === 'Cancel') continue;
    const kind = classifyEvent(p.event, settings);
    if (!kind) continue;
    seen.add(id);
    out.push({
      nws_id: id,
      kind,
      event: String(p.event),
      severity: String(p.severity || '').slice(0, 40),
      headline: String(p.headline || p.event || '').slice(0, 300),
      area: String(p.areaDesc || '').slice(0, 300),
      starts_at: isoOrNull(p.onset || p.effective),
      expires_at: isoOrNull(p.ends || p.expires),
    });
  }
  return out;
}

// Alerts we saved as open or sent whose id is no longer in the feed, or whose time has run out.
export function alertsToEnd(saved, activeIds, now = new Date()) {
  const live = activeIds instanceof Set ? activeIds : new Set(activeIds);
  return (saved || [])
    .filter((a) => ['open', 'sent'].includes(a.status))
    .filter((a) => !live.has(a.nws_id) || (a.expires_at && Date.parse(a.expires_at) < now.getTime()))
    .map((a) => a.id);
}

// days: [{ date, slots: [...] }] from computeOpenSlots (already limited by notice). Counts open times in the next `windowDays` days.
export function summarizeCapacity(days, { now = new Date(), tz = 'America/Chicago', windowDays = 5 } = {}) {
  const today = dateInTz(now, tz);
  const last = new Date(Date.parse(`${today}T12:00:00Z`) + (Math.max(1, windowDays) - 1) * 86400000).toISOString().slice(0, 10);
  const perDay = (days || []).filter((d) => d.date >= today && d.date <= last).map((d) => ({ date: d.date, open: d.slots.length }));
  return { perDay, total: perDay.reduce((n, d) => n + d.open, 0), windowDays };
}

export const STORM_SKIP_LABELS = {
  opted_out: 'Asked to stop reminders',
  open_work: 'Has open work with us',
  no_contact: 'No phone or email',
  messaged_today: 'Already got a message today',
  offered: 'Already messaged for this alert',
};

// customers: [{ id, display_name, first_name, phone, email, opt_out, has_open_work, last_visit_at, last_job: { id, token } | null }]
// blocked: contact keys already messaged in the last day. offered: customer ids already messaged for this alert.
// Past customers, most recent first, capped at the batch size. Returns { eligible, skipped: [{ name, reason, label }], overflow }.
export function planStormOffers({ customers = [], blocked = [], offered = [], settings = {} }) {
  const blockedSet = blocked instanceof Set ? blocked : new Set(blocked);
  const offeredSet = offered instanceof Set ? offered : new Set(offered);
  const max = Math.min(100, Math.max(1, Math.round(Number(settings.storm_max)) || 25));
  const eligible = [];
  const skipped = [];
  for (const c of customers) {
    if (!c.last_job?.token) continue;
    const skip = (reason) => skipped.push({ customer_id: c.id, name: c.display_name, reason, label: STORM_SKIP_LABELS[reason] });
    if (c.opt_out) { skip('opted_out'); continue; }
    if (!c.phone && !c.email) { skip('no_contact'); continue; }
    if (c.has_open_work) { skip('open_work'); continue; }
    if (offeredSet.has(c.id)) { skip('offered'); continue; }
    if (contactKeys({ customer_id: c.id, phone: c.phone, email: c.email }).some((k) => blockedSet.has(k))) { skip('messaged_today'); continue; }
    eligible.push(c);
  }
  eligible.sort((a, b) => String(b.last_visit_at || '').localeCompare(String(a.last_visit_at || '')) || String(a.display_name).localeCompare(String(b.display_name)));
  return { eligible: eligible.slice(0, max), skipped, overflow: Math.max(0, eligible.length - max) };
}

export const stormDedupe = (alertId) => `storm:${alertId}`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const DEFAULT_STORM = 'Hi {first}, after the recent storm in our area, {business} has openings in the next few days. If you need cleaning or water damage help, request a time here: {link}';

// Calm wording. Never names staff. The care page behind the link has the "Stop reminders" button.
export function buildStormMessages({ business, custom = '', firstName, link }) {
  const named = String(business || '').trim();
  const biz = named || 'we';
  const first = String(firstName || '').trim() || 'there';
  const base = renderTemplate(String(custom || '').trim() || DEFAULT_STORM, { first, business: biz, link });
  const sms = `${base} Reply STOP to opt out.`;
  const subject = named ? `${named} has openings after the storm` : 'We have openings after the storm';
  const text = `${base}\n\nTo stop these messages, open the link above and choose "Stop reminders".\n\n${named || ''}`.trim();
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430;max-width:520px">
<p>${esc(base.replace(link, '')).trim()}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Request a time</a></p>
<p style="color:#6b7686;font-size:14px">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>
<p style="color:#6b7686;font-size:13px">To stop these messages, open the link and choose "Stop reminders".</p>
<p>${esc(named)}</p></div>`;
  return { sms, subject, text, html };
}

// What the in-app card says about one alert. Plain and calm.
export function describeAlert(a) {
  const until = a.expires_at ? ` until ${new Date(a.expires_at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
  return { title: a.event, line: `${a.headline && a.headline !== a.event ? a.headline : a.event}${until}`.trim(), area: a.area };
}
