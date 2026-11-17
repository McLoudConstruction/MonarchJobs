// Invoice rules that do not need the database: labels, money parsing, interest, aging, and wording for the
// customer's text and email. Amounts are whole cents everywhere. The database keeps the authoritative totals
// (supabase/migrations/019_invoices_and_payments.sql); these helpers show and check the same numbers on screen.

export const INVOICE_STATUS = { draft: 'Draft', sent: 'Sent', partial: 'Part paid', paid: 'Paid', void: 'Void' };

export const PAYMENT_METHODS = {
  stripe: 'Card',
  square: 'Online (Square)',
  cash: 'Cash',
  check: 'Check',
  other: 'Other',
};

export const centsToText = (c) => {
  const n = Number(c || 0);
  return `${n < 0 ? '-' : ''}$${(Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// "125", "125.5", "$1,250.00" -> cents. Returns null when it is not a usable amount.
export function parseMoneyToCents(input) {
  const s = String(input ?? '').replace(/[$,\s]/g, '');
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === '' || s === '.') return null;
  const cents = Math.round(Number(s) * 100);
  return Number.isFinite(cents) ? cents : null;
}

// Date-only value ("2026-11-16") for today in a time zone; due dates are compared as plain dates.
export function todayIn(tz = 'America/Chicago', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function daysBetween(fromDate, toDate) {
  const a = Date.UTC(...fromDate.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  const b = Date.UTC(...toDate.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.round((b - a) / 86400000);
}

// Open (sent or part paid), still owing, and past its due date.
export function isPastDue(inv, today = todayIn()) {
  return !!inv && (inv.status === 'sent' || inv.status === 'partial') && Number(inv.balance_cents) > 0 && !!inv.due_date && inv.due_date < today;
}

export const daysPastDue = (inv, today = todayIn()) => (isPastDue(inv, today) ? daysBetween(inv.due_date, today) : 0);

// Whole months past due, the default for the interest box (30 days to a month, at least 1 once past due).
export const defaultInterestMonths = (inv, today = todayIn()) => (isPastDue(inv, today) ? Math.min(36, Math.max(1, Math.floor(daysPastDue(inv, today) / 30))) : 0);

// Simple interest per month on what is still unpaid (not on earlier interest), the same sum the database does.
export function interestCents(baseCents, ratePercent, months) {
  const base = Number(baseCents);
  const rate = Number(ratePercent);
  const m = Number(months);
  if (!(base > 0) || !(rate > 0) || !(m > 0)) return 0;
  return Math.round((base * rate * m) / 100);
}

// What interest would be charged on: the unpaid invoice amount before any interest.
export const interestBase = (inv) => Math.max(0, Number(inv.total_cents) - Number(inv.credit_cents) - Number(inv.paid_cents));

// Aging buckets for the money-owed list: 0 = not due yet, then days past due.
export const AGING = [
  { key: 'current', label: 'Not due yet' },
  { key: 'd1_30', label: '1 to 30 days' },
  { key: 'd31_60', label: '31 to 60 days' },
  { key: 'd61', label: '61+ days' },
];
export function agingBucket(inv, today = todayIn()) {
  const d = daysPastDue(inv, today);
  if (d <= 0) return 'current';
  if (d <= 30) return 'd1_30';
  if (d <= 60) return 'd31_60';
  return 'd61';
}

export function agingTotals(invoices, today = todayIn()) {
  const out = { current: 0, d1_30: 0, d31_60: 0, d61: 0, total: 0 };
  for (const inv of invoices || []) {
    if (inv.status !== 'sent' && inv.status !== 'partial') continue;
    const bal = Number(inv.balance_cents);
    if (bal <= 0) continue;
    out[agingBucket(inv, today)] += bal;
    out.total += bal;
  }
  return out;
}

// Chip for the invoice: "Past due 12 days" beats "Sent" once it applies.
export function invoiceChip(inv, today = todayIn()) {
  if (!inv) return { label: '', tone: 'muted' };
  if (inv.status === 'void') return { label: 'Void', tone: 'muted' };
  if (inv.status === 'paid') return { label: 'Paid', tone: 'good' };
  if (inv.status === 'draft') return { label: 'Draft', tone: 'warn' };
  if (isPastDue(inv, today)) return { label: `Past due ${daysPastDue(inv, today)} day${daysPastDue(inv, today) === 1 ? '' : 's'}`, tone: 'bad' };
  return { label: inv.status === 'partial' ? 'Part paid' : 'Sent', tone: inv.status === 'partial' ? 'warn' : 'info' };
}

// Lines as the customer sees them. quantity x unit price, rounded once per line (same as estimates).
export function invoiceLineCents(line) {
  const q = Math.round(Number(line.quantity) * 1000);
  const p = Math.round(Number(line.unit_price) * 100);
  const product = q * p;
  return (product < 0 ? -1 : 1) * Math.round(Math.abs(product) / 1000);
}

export function invoiceTotals(lines, minimumCharge, creditCents = 0, interest = 0, paid = 0) {
  const subtotal = (lines || []).reduce((s, l) => s + invoiceLineCents(l), 0);
  const min = Math.round(Number(minimumCharge || 0) * 100);
  const adj = subtotal > 0 && subtotal < min ? min - subtotal : 0;
  const total = subtotal + adj;
  return { subtotalCents: subtotal, minimumAdjustmentCents: adj, totalCents: total, balanceCents: total - creditCents + interest - paid };
}

// A tech may take a payment only on a job they are on, and only by card; cash and check go through the office.
export const canVoid = (role, officeCanVoid) => role === 'owner' || (role === 'office' && !!officeCanVoid);
export const canReopen = canVoid;

// Interest is for business customers by default (a setting). Returns a warning to confirm, or ''.
export function interestWarning(customerType, commercialOnly) {
  if (commercialOnly && customerType && customerType !== 'commercial') {
    return 'This is not a business customer. Late interest on a household customer is easy to dispute and may be limited by law. Add it anyway?';
  }
  return '';
}

// ----------------------------------------------------------------------- messages
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only a link goes out; the invoice, photos and payment options live on the page.
export function buildInvoiceMessages({ business, customerName, link, amountCents, dueDate, number, resend = false, pastDue = false }) {
  const biz = (business || '').trim() || 'us';
  const first = String(customerName || '').trim().split(/\s+/)[0];
  const hello = first ? `Hi ${first}, ` : 'Hi, ';
  const amt = centsToText(amountCents);
  const due = dueDate ? `, due ${dueDate}` : '';
  const sms = pastDue
    ? `${hello}a reminder from ${biz}: invoice #${number} for ${amt} is past due. View and pay it here: ${link}`
    : resend
      ? `${hello}here is your invoice from ${biz} again (${amt}${due}): ${link}`
      : `${hello}your invoice from ${biz} is ready (${amt}${due}). View and pay it here: ${link}`;
  const subject = pastDue ? `Reminder: invoice #${number} from ${biz} is past due` : `Invoice #${number} from ${biz}`;
  const lead = pastDue ? `This is a reminder that invoice #${number} for ${amt} is past due.` : `Your invoice #${number} from ${biz} is ready: ${amt}${due}.`;
  const text = `${hello.replace(/, $/, ',')}\n\n${lead} You can see the details and pay online here:\n${link}\n\nIf you have questions, just reply or give us a call.\n\n${biz}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430;max-width:520px">
<p>${esc(hello.replace(/, $/, ','))}</p>
<p>${esc(lead)}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">View and pay invoice</a></p>
<p style="color:#6b7686;font-size:14px">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>
<p>If you have questions, just reply or give us a call.</p>
<p>${esc(biz)}</p></div>`;
  return { sms, subject, text, html };
}

// ----------------------------------------------------------------------- reading what Stripe and Square tell us
// Turns a verified webhook body into one plain action the server then applies. Everything unknown is "ignore".

const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

export function interpretStripeEvent(event) {
  const type = event?.type;
  const o = event?.data?.object || {};
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    if (o.payment_status && o.payment_status !== 'paid') return { kind: 'ignore' };
    const invoiceId = o.metadata?.invoice_id || o.client_reference_id || null;
    if (!invoiceId || !o.payment_intent) return { kind: 'ignore' };
    return { kind: 'payment', invoiceId, amountCents: num(o.amount_total), tipCents: 0, ref: String(o.payment_intent), sessionRef: o.id, method: 'stripe' };
  }
  if (type === 'checkout.session.async_payment_failed' || type === 'payment_intent.payment_failed') {
    const invoiceId = o.metadata?.invoice_id || null;
    if (!invoiceId) return { kind: 'ignore' };
    const why = o.last_payment_error?.message || 'The card was declined.';
    return { kind: 'payment_failed', invoiceId, reason: why };
  }
  if (type === 'refund.created' || type === 'refund.updated') {
    if (o.status && o.status !== 'succeeded') return { kind: 'ignore' };
    if (!o.id || !o.payment_intent) return { kind: 'ignore' };
    return { kind: 'refund', paymentRef: String(o.payment_intent), ref: String(o.id), amountCents: num(o.amount), method: 'stripe' };
  }
  if (type === 'charge.dispute.created') {
    if (!o.payment_intent) return { kind: 'ignore' };
    return { kind: 'dispute', paymentRef: String(o.payment_intent), amountCents: num(o.amount), method: 'stripe', reason: o.reason || '' };
  }
  return { kind: 'ignore' };
}

export function interpretSquareEvent(event) {
  const type = event?.type;
  const data = event?.data?.object || {};
  if (type === 'payment.created' || type === 'payment.updated') {
    const p = data.payment || {};
    if (p.status === 'COMPLETED') {
      if (!p.id || !p.order_id) return { kind: 'ignore' };
      return { kind: 'payment', orderRef: p.order_id, amountCents: num(p.amount_money?.amount), tipCents: num(p.tip_money?.amount), ref: p.id, method: 'square' };
    }
    if (p.status === 'FAILED' && p.order_id) return { kind: 'payment_failed', orderRef: p.order_id, reason: 'The payment did not go through.' };
    return { kind: 'ignore' };
  }
  if (type === 'refund.created' || type === 'refund.updated') {
    const r = data.refund || {};
    if (r.status !== 'COMPLETED' || !r.id || !r.payment_id) return { kind: 'ignore' };
    return { kind: 'refund', paymentRef: r.payment_id, ref: r.id, amountCents: num(r.amount_money?.amount), method: 'square' };
  }
  if (type === 'dispute.created') {
    const d = data.dispute || data.object || {};
    const paymentId = d.disputed_payment?.payment_id || d.payment_id;
    if (!paymentId) return { kind: 'ignore' };
    return { kind: 'dispute', paymentRef: paymentId, amountCents: num(d.amount_money?.amount), method: 'square', reason: d.reason || '' };
  }
  return { kind: 'ignore' };
}
