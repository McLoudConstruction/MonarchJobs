// One-document PDFs for the office to download or print: a single estimate or a single invoice, on the company letterhead
// (logo or name, phone, email). Pure: it gets plain rows and returns PDF bytes. Never names staff or prints IP addresses.
// Amounts are whole cents. The estimate shows what the customer sees: options with their totals while the customer has not
// chosen, the chosen lines and total once approved.
import { PdfDoc, wrapText } from './pdfDoc.js';
import { centsToText, invoiceLineCents, INVOICE_STATUS, PAYMENT_METHODS } from './invoice.js';
import { drawBrandHeader, BRAND } from './reportBrand.js';
import { estimateTotals, lineCents, ESTIMATE_STATUS } from './estimate.js';
import { tiersPresent, tierTotals, optionalLines, effectiveLines, choiceFromEstimate, TIER_LABELS } from './estimateOptions.js';

const INK = '#212529';
const MUTED = '#6c757d';
const RULE = '#ced4da';
const M = 40;
const PW = 612;
const PH = 792;
const CW = PW - M * 2;
const BOTTOM = PH - 48;

const TZ = 'America/Chicago';
const dayText = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ }) : '';
};
const qtyText = (q) => String(Number(q)).replace(/\.0+$/, '');
const unitText = (u) => (u && u !== 'each' && u !== 'flat' ? u : '');

// Shared page layout: a cursor going down the page, new pages when it runs out, a running head on pages after the first.
function layout(doc, runningHead) {
  const L = { y: M };
  L.newPage = () => { doc.addPage(); L.y = M; doc.text(M, L.y + 8, runningHead, { size: 8, color: MUTED }); L.y += 22; };
  L.ensure = (h) => { if (L.y + h > BOTTOM) L.newPage(); };
  L.row = (left, right, { bold = false, size = 9.5, color = INK, indent = 0 } = {}) => {
    L.ensure(15);
    doc.text(M + indent, L.y + 10, left, { size, bold, color });
    if (right !== undefined && right !== '') doc.text(PW - M, L.y + 10, right, { size, bold, color, align: 'right' });
    L.y += 14;
  };
  L.para = (t, { size = 9.5, color = INK, indent = 0 } = {}) => {
    for (const ln of wrapText(String(t || ''), CW - indent, size, false)) { L.ensure(13); doc.text(M + indent, L.y + 10, ln, { size, color }); L.y += 13; }
  };
  L.tableHead = () => {
    L.ensure(24);
    doc.rect(M, L.y, CW, 18, { fill: '#f1f3f5' });
    doc.text(M + 8, L.y + 12.5, 'Description', { size: 8.5, bold: true, color: MUTED });
    doc.text(M + 330, L.y + 12.5, 'Qty', { size: 8.5, bold: true, color: MUTED, align: 'right' });
    doc.text(M + 410, L.y + 12.5, 'Price', { size: 8.5, bold: true, color: MUTED, align: 'right' });
    doc.text(PW - M - 8, L.y + 12.5, 'Amount', { size: 8.5, bold: true, color: MUTED, align: 'right' });
    L.y += 22;
  };
  L.line = (l, cents) => {
    const rows = wrapText(l.description || '', 270, 9.5, false);
    L.ensure(rows.length * 12 + 6);
    rows.forEach((t, i) => doc.text(M + 8, L.y + 10 + i * 12, t, { size: 9.5 }));
    doc.text(M + 330, L.y + 10, `${qtyText(l.quantity)} ${unitText(l.unit)}`.trim(), { size: 9.5, align: 'right' });
    doc.text(M + 410, L.y + 10, centsToText(Math.round(Number(l.unit_price) * 100)), { size: 9.5, align: 'right' });
    doc.text(PW - M - 8, L.y + 10, centsToText(cents), { size: 9.5, align: 'right' });
    L.y += rows.length * 12 + 4;
    doc.line(M, L.y, PW - M, L.y, { color: '#e9ecef', width: 0.5 });
    L.y += 2;
  };
  L.total = (k, v, bold = false) => {
    L.ensure(15);
    doc.text(PW - M - 150, L.y + 10, k, { size: 9.5, bold, color: bold ? INK : '#343a40' });
    doc.text(PW - M - 8, L.y + 10, v, { size: 9.5, bold, align: 'right' });
    L.y += 14;
  };
  L.heading = (t, right) => {
    L.ensure(40);
    doc.text(M, L.y + 15, t, { size: 11, bold: true, color: INK });
    if (right) doc.text(PW - M - 8, L.y + 15, right, { size: 10, bold: true, color: INK, align: 'right' });
    L.y += 22;
  };
  return L;
}

// the top of every document: letterhead, big title with its status on the right, then who and where
function opening(doc, L, info, title, status, facts) {
  L.y = drawBrandHeader(doc, info, L.y, M, PW);
  doc.text(M, L.y + 24, title, { size: 26, bold: true, color: INK });
  if (status) doc.text(PW - M, L.y + 24, status, { size: 11, bold: true, color: BRAND.color, align: 'right' });
  L.y += 44;
  const rows = facts.filter(([, v]) => v);
  if (!rows.length) return;
  const boxH = 14 + rows.length * 15 + 4;
  doc.rect(M, L.y, CW, boxH, { fill: BRAND.soft, stroke: RULE });
  let fy = L.y + 18;
  for (const [k, v] of rows) { doc.text(M + 12, fy, k, { size: 9, color: MUTED }); doc.text(M + 110, fy, v, { size: 9.5, color: INK }); fy += 15; }
  L.y += boxH + 18;
}

// info: { business, phone, email, logo, customer, address, jobNumber, jobType }
// invoice: invoices row with .lines and .payments
export function renderInvoicePdf({ info = {}, invoice: inv, preparedAt = new Date() }) {
  const doc = new PdfDoc({ title: `Invoice ${inv.invoice_number}${info.customer ? ` - ${info.customer}` : ''}` });
  doc.addPage();
  const L = layout(doc, `Invoice #${inv.invoice_number}${info.customer ? ` · ${info.customer}` : ''}`);
  opening(doc, L, info, `Invoice #${inv.invoice_number}`, INVOICE_STATUS[inv.status] || '', [
    ['Billed to', inv.bill_to_name || info.customer],
    ['Property', info.address],
    ['Job', [info.jobNumber ? `#${info.jobNumber}` : '', info.jobType].filter(Boolean).join(' · ')],
    ['Issued', dayText(inv.issued_at)],
    ['Due', inv.due_date ? dayText(`${inv.due_date}T12:00:00`) : ''],
    ['PO number', inv.po_number],
  ]);
  if (inv.scope_note) { L.para(inv.scope_note, { size: 9, color: '#343a40' }); L.y += 6; }
  L.tableHead();
  for (const l of inv.lines || []) L.line(l, invoiceLineCents(l));
  L.y += 6;
  L.total('Subtotal', centsToText(inv.subtotal_cents));
  if (inv.minimum_adjustment_cents) L.total('Minimum charge top-up', centsToText(inv.minimum_adjustment_cents));
  L.total('Total', centsToText(inv.total_cents), true);
  if (inv.credit_cents) L.total('Paid on earlier invoice', `-${centsToText(inv.credit_cents)}`);
  if (inv.interest_cents) L.total('Interest', centsToText(inv.interest_cents));
  const pays = (inv.payments || []).slice().sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)));
  if (pays.length) {
    L.y += 10;
    L.heading('Payments');
    for (const p of pays) {
      L.row(`${dayText(p.received_at)}  ·  ${PAYMENT_METHODS[p.method] || p.method}${p.reference ? ` ${p.reference}` : ''}${p.amount_cents < 0 ? '  ·  refund' : ''}`, centsToText(p.amount_cents), { indent: 8 });
      if (p.tip_cents) L.row(`Tip ${centsToText(p.tip_cents)}`, '', { indent: 16, size: 8.5, color: MUTED });
    }
  }
  L.y += 6;
  L.total('Paid', centsToText(inv.paid_cents));
  L.total(inv.balance_cents > 0 ? 'Balance due' : 'Balance', centsToText(inv.balance_cents), true);
  if (inv.footer_note || info.invoiceFooter) { L.y += 12; L.para(inv.footer_note || info.invoiceFooter, { size: 8.5, color: MUTED }); }
  void preparedAt;
  return doc.finish();
}

// estimate: estimates row (status, minimum_charge, chosen_tier, sent_at, approved_at); lines: estimate_lines rows;
// signature: latest estimate_signatures row or null
export function renderEstimatePdf({ info = {}, estimate: est, lines = [], signature = null }) {
  const doc = new PdfDoc({ title: `Estimate${info.customer ? ` - ${info.customer}` : ''}` });
  doc.addPage();
  const L = layout(doc, `Estimate${info.customer ? ` · ${info.customer}` : ''}`);
  const approved = est.status === 'approved';
  const tiers = tiersPresent(lines);
  opening(doc, L, info, 'Estimate', ESTIMATE_STATUS[est.status] || '', [
    ['Prepared for', info.customer],
    ['Property', info.address],
    ['Job', [info.jobNumber ? `#${info.jobNumber}` : '', info.jobType].filter(Boolean).join(' · ')],
    ['Sent', dayText(est.sent_at)],
  ]);

  const minimum = Number(est.minimum_charge) || 0;
  if (tiers.length && !approved) {
    // the customer has not chosen yet: every option with its own total, then the add-ons
    const included = lines.filter((l) => !l.tier && !l.optional);
    const per = tierTotals(lines, minimum);
    if (included.length) { L.heading('Included in every option'); L.tableHead(); for (const l of included) L.line(l, lineCents(l)); L.y += 6; }
    for (const t of tiers) {
      L.heading(`Option: ${TIER_LABELS[t]}`, centsToText(per[t].totalCents));
      L.tableHead();
      for (const l of lines.filter((x) => x.tier === t)) L.line(l, lineCents(l));
      L.y += 8;
    }
    const adds = optionalLines(lines);
    if (adds.length) { L.heading('Optional add-ons'); L.tableHead(); for (const l of adds) L.line(l, lineCents(l)); L.y += 6; }
    L.para('The total depends on the option chosen. Option totals include everything under "Included in every option".', { size: 8.5, color: MUTED });
  } else {
    const shown = approved ? effectiveLines(lines, choiceFromEstimate(est, lines)) : effectiveLines(lines, { tier: null, picks: [] });
    const t = estimateTotals(shown, minimum);
    if (approved && est.chosen_tier && TIER_LABELS[est.chosen_tier]) L.para(`Option chosen: ${TIER_LABELS[est.chosen_tier]}`, { size: 9.5, color: '#343a40' });
    L.tableHead();
    for (const l of shown) L.line(l, lineCents(l));
    L.y += 6;
    L.total('Subtotal', centsToText(t.subtotalCents));
    if (t.minimumAdjustmentCents) L.total(`Minimum charge ${centsToText(Math.round(minimum * 100))}`, centsToText(t.minimumAdjustmentCents));
    L.total(approved ? 'Total agreed' : 'Total', centsToText(t.totalCents), true);
  }
  if (approved && signature) {
    L.y += 14;
    L.ensure(40);
    doc.rect(M, L.y, CW, 32, { fill: '#f8f9fa', stroke: RULE });
    doc.text(M + 10, L.y + 20, `Approved online by ${signature.signer_name || 'the customer'} on ${dayText(signature.signed_at)}`, { size: 10, bold: true, color: INK });
    L.y += 40;
  }
  return doc.finish();
}

export const invoiceFileName = (info, inv) => `invoice-${inv.invoice_number}${info.jobNumber ? `-job-${info.jobNumber}` : ''}.pdf`;
export const estimateFileName = (info) => `estimate${info.jobNumber ? `-job-${info.jobNumber}` : info.customer ? `-${String(info.customer).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}` : ''}.pdf`;
