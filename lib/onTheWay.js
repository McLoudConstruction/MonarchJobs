// The customer's "on the way" text and email, and the facts shown on their status page. Pure, so it can be tested.
// Nothing here ever names a staff member: customers see the business, the time and the address only.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = (n) => String(n || '').trim().split(/\s+/)[0];

export const STALE_MINUTES = 30; // a tap saved on a phone with no signal and sent later is not texted when it is this old

// Whether to text the customer for this tap. when: the time the tap really happened.
export function shouldNotify({ action, enabled, when, now = new Date() }) {
  if (action !== 'on_the_way' || enabled === false) return false;
  return now.getTime() - new Date(when).getTime() <= STALE_MINUTES * 60000;
}

// A live drive time (seconds) turned into the minutes the customer is told: rounded up to the next 5, at least 5, at most 120.
export function etaFromSeconds(seconds) {
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec < 0) return null;
  const exact = Math.max(1, Math.round(sec / 60));
  return { exact, rounded: Math.min(120, Math.max(5, Math.ceil(exact / 5) * 5)) };
}

export const arrivalAt = (onTheWayAt, minutes) => (onTheWayAt && Number(minutes) > 0 ? new Date(new Date(onTheWayAt).getTime() + Number(minutes) * 60000) : null);

export function timeText(date, timeZone) {
  if (!date) return '';
  try { return new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }); } catch { return ''; }
}

export function buildOnTheWayMessages({ business, customerName, minutes, arrive = '', link, late = false }) {
  const biz = String(business || '').trim() || 'Our team';
  const first = firstName(customerName);
  const hello = first ? `Hi ${first}, ` : 'Hi, ';
  const mins = Number(minutes);
  const when = mins > 0 ? `about ${mins} minutes away${arrive ? ` (around ${arrive})` : ''}` : 'on the way';
  const lead = late ? 'A quick update: ' : '';
  const sms = `${hello}${lead}${biz} is ${when}. Follow along here: ${link}`;
  const subject = late ? `Updated arrival time from ${biz}` : `${biz} is on the way`;
  const text = `${hello.replace(/, $/, ',')}\n\n${lead}${biz} is ${when}.\n\nFollow along or contact us here:\n${link}\n\n${biz}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430;max-width:520px">
<p>${esc(hello.replace(/, $/, ','))}</p>
<p>${esc(lead)}<strong>${esc(biz)}</strong> is ${esc(when)}.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Follow along</a></p>
<p style="color:#6b7686;font-size:14px">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>
<p>${esc(biz)}</p></div>`;
  return { sms, subject, text, html };
}

// What the landing page says for a visit. step: 'scheduled' | 'on_the_way' | 'started' | 'finished' | 'cancelled'
export function landingStatus(visit, { timeZone } = {}) {
  const step = visit?.status || 'scheduled';
  const arrive = step === 'on_the_way' ? arrivalAt(visit.on_the_way_at, visit.minutes_out) : null;
  const headline = {
    scheduled: 'Your visit is scheduled',
    on_the_way: Number(visit?.minutes_out) > 0 ? `We are about ${visit.minutes_out} minutes away` : 'We are on the way',
    started: 'We are working at your place now',
    finished: 'Today’s work is finished',
    cancelled: 'This visit was cancelled',
  }[step] || 'Your visit';
  const detail = step === 'on_the_way' && arrive ? `Expected around ${timeText(arrive, timeZone)}${visit.eta_live ? ', based on current traffic' : ''}. If that changes, this page updates.` : step === 'scheduled' ? 'This page will update when we are on the way.' : step === 'finished' ? 'Thank you. Contact us any time with questions.' : '';
  return { step, headline, detail, arriveAt: arrive ? arrive.toISOString() : null };
}
