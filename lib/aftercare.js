// Aftercare: what the customer should know once the cleaning is done (drying time, what to do and not do).
// The words come from the price list: each service can carry its own aftercare text and drying time, and the
// owner can set a general note that goes with every job. Pure, so it can be tested.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = (n) => String(n || '').trim().split(/\s+/)[0];

// lines: the estimate lines that count (price_item_id may be empty for custom lines)
// items: price items by id { name, aftercare, dry_hours }
// postDryHours: the drying time the tech wrote on the signed after-cleaning record, if any
export function aftercareFor({ lines = [], items = {}, defaultText = '', postDryHours = null }) {
  const notes = [];
  const general = String(defaultText || '').trim();
  if (general) notes.push({ service: '', text: general });
  const seen = new Set();
  let dry = 0;
  for (const l of lines) {
    const it = items[l.price_item_id];
    if (!it || seen.has(l.price_item_id)) continue;
    seen.add(l.price_item_id);
    const text = String(it.aftercare || '').trim();
    if (text) notes.push({ service: it.name, text });
    if (Number(it.dry_hours) > dry) dry = Number(it.dry_hours);
  }
  const post = Number(postDryHours);
  const dryHours = Number.isFinite(post) && post >= 1 ? post : dry || null;
  return { notes, dryHours, hasContent: notes.length > 0 || !!dryHours };
}

export const dryText = (h) => (h ? `Your floors should be dry in about ${h} hour${h === 1 ? '' : 's'}.` : '');

// The text and email sent when a job is finished. The text is short and carries a link; the email has the full notes.
export function buildAftercareMessages({ business, customerName, link, notes = [], dryHours = null }) {
  const biz = String(business || '').trim() || 'us';
  const first = firstName(customerName);
  const hello = first ? `Hi ${first}, ` : 'Hi, ';
  const dry = dryText(dryHours);
  const sms = `${hello}thank you for choosing ${biz}! ${dry ? `${dry} ` : ''}Care instructions, and a way to tell us if anything is not right: ${link}`;
  const subject = `Care instructions from ${biz}`;
  const body = notes.map((n) => (n.service ? `${n.service}: ${n.text}` : n.text)).join('\n\n');
  const text = `${hello.replace(/, $/, ',')}\n\nThank you for choosing ${biz}.${dry ? ` ${dry}` : ''}\n\n${body ? `${body}\n\n` : ''}If anything is not right, tell us here and we will make it right:\n${link}\n\n${biz}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430;max-width:520px">
<p>${esc(hello.replace(/, $/, ','))}</p>
<p>Thank you for choosing <strong>${esc(biz)}</strong>.${dry ? ` ${esc(dry)}` : ''}</p>
${notes.map((n) => `<p>${n.service ? `<strong>${esc(n.service)}</strong><br>` : ''}${esc(n.text).replace(/\n/g, '<br>')}</p>`).join('\n')}
<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Care instructions, or report a problem</a></p>
<p style="color:#6b7686;font-size:14px">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>
<p>${esc(biz)}</p></div>`;
  return { sms, subject, text, html };
}
