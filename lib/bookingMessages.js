// Wording for the "you're booked" text and email. Pure, so it can be tested.
// Never includes gate codes, notes or staff names: only the business, the time and the street.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function buildBookingMessages({ business, customerName, when, street, link, phone }) {
  const biz = (business || '').trim() || 'us';
  const first = String(customerName || '').trim().split(/\s+/)[0];
  const hello = first ? `Hi ${first},` : 'Hi,';
  const where = street ? ` at ${street}` : '';
  const call = phone ? ` To change it, call ${phone}.` : ' To change it, just reply or give us a call.';
  const sms = `${hello} you're booked with ${biz} for ${when}${where}.${call}${link ? ` Details: ${link}` : ''}`;
  const subject = `You're booked with ${biz}: ${when}`;
  const text = `${hello}\n\nYou're booked with ${biz}.\n\nWhen: ${when}${street ? `\nWhere: ${street}` : ''}\n${link ? `\nYour estimate and booking details:\n${link}\n` : ''}\n${call.trim()}\n\n${biz}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430;max-width:520px">
<p>${esc(hello)}</p>
<p>You're booked with <strong>${esc(biz)}</strong>.</p>
<p><strong>When:</strong> ${esc(when)}${street ? `<br><strong>Where:</strong> ${esc(street)}` : ''}</p>
${link ? `<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">View your booking</a></p>` : ''}
<p>${esc(call.trim())}</p>
<p>${esc(biz)}</p></div>`;
  return { sms, subject, text, html };
}
