// Wording for the estimate text and email. Pure, so it can be tested.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only a link goes out; the estimate itself is viewed on the site.
export function buildEstimateMessages({ business, customerName, link, resend = false }) {
  const biz = (business || '').trim() || 'us';
  const first = String(customerName || '').trim().split(/\s+/)[0];
  const hello = first ? `Hi ${first}, ` : 'Hi, ';
  const sms = resend
    ? `${hello}here is your estimate from ${biz} again, ready to view and approve: ${link}`
    : `${hello}your estimate from ${biz} is ready to view and approve: ${link}`;
  const subject = `Your estimate from ${biz}`;
  const text = `${hello.replace(/, $/, ',')}\n\nYour estimate from ${biz} is ready. You can review it and approve it online:\n${link}\n\nIf you have questions, just reply or give us a call.\n\n${biz}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430;max-width:520px">
<p>${esc(hello.replace(/, $/, ','))}</p>
<p>Your estimate from <strong>${esc(biz)}</strong> is ready. You can review it and approve it online.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">View your estimate</a></p>
<p style="color:#6b7686;font-size:14px">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>
<p>If you have questions, just reply or give us a call.</p>
<p>${esc(biz)}</p></div>`;
  return { sms, subject, text, html };
}
