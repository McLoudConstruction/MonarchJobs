// "On your street" offers (push 1C, #35). After a job is finished, past customers on the same street can be offered a visit.
// This file decides who qualifies and what the message says; lib/streetOffersServer.js loads the data and sends.
// Pure, so it can be tested. Nothing is sent without the owner or office tapping Send.
import { contactKeys } from './estimateFollowup.js';
import { dateInTz, renderTemplate } from './outreach.js';

export const MAX_BATCH = 50;

const SUFFIX = {
  st: 'street', str: 'street', ave: 'avenue', av: 'avenue', rd: 'road', dr: 'drive', ln: 'lane', ct: 'court', blvd: 'boulevard',
  cir: 'circle', pl: 'place', ter: 'terrace', trl: 'trail', pkwy: 'parkway', hwy: 'highway', way: 'way',
};
const DIR = { n: 'north', s: 'south', e: 'east', w: 'west', ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest' };

// "1204 N. Maple St., Apt 3" -> "north maple street". '' when there is no street name.
export function streetKey(street) {
  let s = String(street ?? '').toLowerCase().replace(/[.,#]/g, ' ');
  s = s.replace(/\b(apt|apartment|unit|suite|ste|lot|bldg)\b.*$/, ' ');
  const words = s.split(/\s+/).filter(Boolean);
  while (words.length && /^\d+[a-z]?$/.test(words[0])) words.shift();
  const out = words.map((w, i) => (DIR[w] && i < words.length - 1 ? DIR[w] : SUFFIX[w] && i === words.length - 1 ? SUFFIX[w] : w));
  return out.join(' ').trim();
}

export function houseNumber(street) {
  const m = String(street ?? '').trim().match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

const cityKey = (c) => String(c ?? '').trim().toLowerCase();

export function sameStreet(a, b) {
  const ka = streetKey(a?.street);
  return !!ka && ka === streetKey(b?.street) && cityKey(a?.city) === cityKey(b?.city);
}

export const SKIP_LABELS = {
  opted_out: 'Asked to stop reminders',
  open_work: 'Has open work with us',
  no_contact: 'No phone or email',
  recent: 'Cleaned very recently',
  messaged_today: 'Already got a message today',
  offered: 'Already offered for this job',
};

// job: { customer_id, address: { street, city } }  the finished job
// candidates: [{ customer_id, display_name, first_name, phone, email, opt_out, has_open_work, last_visit_at, address: { street, city }, last_job: { id, token } | null }]
// blocked: contact keys already messaged today. offered: customer ids already offered for this job.
// settings: { street_offer_max, street_offer_quiet_days }
// Returns { eligible, skipped }. eligible is nearest house number first and capped at the batch size.
export function planStreetOffers({ now = new Date(), tz = 'America/Chicago', job, candidates = [], blocked = [], offered = [], settings = {} }) {
  const today = dateInTz(now, tz);
  const blockedSet = blocked instanceof Set ? blocked : new Set(blocked);
  const offeredSet = offered instanceof Set ? offered : new Set(offered);
  const max = Math.min(MAX_BATCH, Math.max(1, Math.round(Number(settings.street_offer_max)) || 10));
  const quiet = Math.max(0, Math.round(Number(settings.street_offer_quiet_days)) || 0);
  const here = houseNumber(job?.address?.street);
  const eligible = [];
  const skipped = [];

  for (const c of candidates) {
    if (c.customer_id === job?.customer_id) continue;
    if (!sameStreet(job?.address, c.address)) continue;
    if (!c.last_job?.token) continue;
    const skip = (reason) => skipped.push({ customer_id: c.customer_id, name: c.display_name, reason, label: SKIP_LABELS[reason] });
    if (c.opt_out) { skip('opted_out'); continue; }
    if (!c.phone && !c.email) { skip('no_contact'); continue; }
    if (c.has_open_work) { skip('open_work'); continue; }
    if (offeredSet.has(c.customer_id)) { skip('offered'); continue; }
    if (contactKeys({ customer_id: c.customer_id, phone: c.phone, email: c.email }).some((k) => blockedSet.has(k))) { skip('messaged_today'); continue; }
    if (quiet > 0 && c.last_visit_at) {
      const days = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${dateInTz(c.last_visit_at, tz)}T12:00:00Z`)) / 86400000;
      if (days < quiet) { skip('recent'); continue; }
    }
    const n = houseNumber(c.address?.street);
    eligible.push({ ...c, distance: here != null && n != null ? Math.abs(here - n) : Number.MAX_SAFE_INTEGER, house: c.address?.street || '' });
  }
  eligible.sort((a, b) => a.distance - b.distance || String(a.display_name).localeCompare(String(b.display_name)));
  return { eligible: eligible.slice(0, max), skipped, overflow: Math.max(0, eligible.length - max) };
}

// ------------------------------------------------------------------ wording
// Never names the customer whose job was just finished, and never says which street, only "your neighborhood".
const DEFAULT_OFFER = 'We have a few openings nearby this week.';

export function buildStreetOfferMessages({ business, offer = '', firstName, link }) {
  const named = String(business || '').trim();
  const biz = named || 'us';
  const who = named || 'we';
  const first = String(firstName || '').trim() || 'there';
  const line = renderTemplate(String(offer || '').trim() || DEFAULT_OFFER, { first, business: biz, link });
  const base = `Hi ${first}, ${who} just finished a job in your neighborhood. ${line} Request a time here: ${link}`;
  const sms = `${base} Reply STOP to opt out.`;
  const subject = named ? `${named} is working in your neighborhood` : 'We are working in your neighborhood';
  const text = `${base}\n\nTo stop these messages, open the link above and choose "Stop reminders".\n\n${biz}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430;max-width:520px">
<p>Hi ${esc(first)}, ${esc(who)} just finished a job in your neighborhood. ${esc(line)}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Request a time</a></p>
<p style="color:#6b7686;font-size:14px">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>
<p style="color:#6b7686;font-size:13px">To stop these messages, open the link and choose "Stop reminders".</p>
<p>${esc(biz)}</p></div>`;
  return { sms, subject, text, html };
}

export const streetDedupe = (jobId) => `street:${jobId}`;
