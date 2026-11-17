// The full job packet: ONE PDF that holds the paperwork of a job in the order a customer, an insurer or a lawyer reads it:
//   cover (who, what, when, what is inside) -> invoices with their payments -> the signed estimate -> the signed inspections.
// Pure: it gets plain rows and signature images already converted to JPEG (see lib/jobPacketClient.js). Never names staff,
// never prints IP addresses or devices. Amounts are whole cents.
import { PdfDoc, textWidth, wrapText } from './pdfDoc.js';
import { centsToText, invoiceLineCents, INVOICE_STATUS, PAYMENT_METHODS } from './invoice.js';
import { KINDS as INSPECTION_KINDS, FIBERS, PRETEST, RESULTS, cleanInspection, latestSigned } from './inspection.js';

const INK = '#212529';
const MUTED = '#6c757d';
const RULE = '#ced4da';
const M = 40;
const PW = 612;
const PH = 792;
const CW = PW - M * 2;
const BOTTOM = PH - 48;

const dateText = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }) : '';
};
const dayText = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }) : '';
};
const qtyText = (q) => String(Number(q)).replace(/\.0+$/, '');

// Which signed documents the packet will hold, for the screen ("3 documents: ...").
// input: { invoices, estimate (with .signature), inspections }
export function packetContents(input = {}) {
  const invoices = (input.invoices || []).filter((i) => i.status !== 'draft' && i.status !== 'void');
  const est = input.estimate?.signature ? input.estimate : null;
  const pre = latestSigned(input.inspections, 'pre');
  const post = latestSigned(input.inspections, 'post');
  const parts = [];
  if (invoices.length) parts.push(`${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`);
  if (est) parts.push('signed estimate');
  if (pre) parts.push('signed before-cleaning inspection');
  if (post) parts.push('signed after-cleaning inspection');
  return { invoices, estimate: est, pre, post, parts, empty: parts.length === 0 };
}

// opts: { info: {business, phone, email, customer, address, jobNumber, jobType}, invoices: [{...invoice, lines, payments}],
//         estimate: {..., signature: {signer_name, signed_at, total_cents, minimum_charge, lines_snapshot, preferred_times}} | null,
//         inspections: [job_inspections rows], signatures: Map<id, {bytes,w,h}> keyed 'estimate' / inspection id, preparedAt }
export function renderJobPacket(opts = {}) {
  const info = opts.info || {};
  const c = packetContents(opts);
  const sigs = opts.signatures || new Map();
  const title = [info.address, info.customer].filter(Boolean).join(' · ') || `Job ${info.jobNumber || ''}`;
  const doc = new PdfDoc({ title: `Job packet - ${title}` });
  doc.addPage();
  let y = M;

  const newPage = () => { doc.addPage(); y = M; doc.text(M, y + 8, `Job packet · ${title}`, { size: 8, color: MUTED }); y += 22; };
  const ensure = (h) => { if (y + h > BOTTOM) newPage(); };
  const section = (t, sub) => {
    ensure(70);
    doc.text(M, y + 15, t, { size: 15, bold: true, color: INK });
    if (sub) doc.text(PW - M, y + 15, sub, { size: 9, color: MUTED, align: 'right' });
    doc.line(M, y + 22, PW - M, y + 22, { color: RULE, width: 0.75 });
    y += 34;
  };
  const row = (left, right, { bold = false, size = 9.5, color = INK, indent = 0 } = {}) => {
    ensure(15);
    doc.text(M + indent, y + 10, left, { size, bold, color });
    if (right !== undefined && right !== '') doc.text(PW - M, y + 10, right, { size, bold, color, align: 'right' });
    y += 14;
  };
  const para = (t, { size = 9.5, color = INK, indent = 0 } = {}) => {
    for (const ln of wrapText(String(t || ''), CW - indent, size, false)) {
      ensure(13);
      doc.text(M + indent, y + 10, ln, { size, color });
      y += 13;
    }
  };
  const signatureBlock = (img, name, signedAt) => {
    ensure(100);
    doc.rect(M, y, 230, 70, { fill: '#ffffff', stroke: RULE });
    if (img) {
      const k = Math.min(218 / img.w, 58 / img.h);
      const iw = img.w * k;
      const ih = img.h * k;
      doc.image(img.bytes, img.w, img.h, M + 6 + (218 - iw) / 2, y + 6 + (58 - ih) / 2, iw, ih);
    } else {
      doc.text(M + 8, y + 38, '(signature image not available)', { size: 8.5, color: MUTED });
    }
    doc.text(M + 242, y + 22, 'Signed by', { size: 8.5, color: MUTED });
    doc.text(M + 242, y + 36, name || '', { size: 11, bold: true, color: INK });
    doc.text(M + 242, y + 52, dateText(signedAt), { size: 9, color: '#343a40' });
    y += 84;
  };

  // ------------------------------------------------------------------------------------------------ cover
  if (info.business) {
    doc.text(M, y + 10, info.business, { size: 11, bold: true, color: '#343a40' });
    const contact = [info.phone, info.email].filter(Boolean).join('  ·  ');
    if (contact) doc.text(PW - M, y + 10, contact, { size: 8.5, color: MUTED, align: 'right' });
    y += 22;
  }
  doc.text(M, y + 24, 'Job Packet', { size: 26, bold: true, color: INK });
  y += 38;
  doc.text(M, y + 12, title, { size: 12, color: '#343a40' });
  doc.text(PW - M, y + 12, `Prepared ${dateText(opts.preparedAt || new Date())}`, { size: 9, color: MUTED, align: 'right' });
  y += 28;
  const facts = [
    ...(info.customer ? [['Customer', info.customer]] : []),
    ...(info.address ? [['Property', info.address]] : []),
    ...(info.jobNumber || info.jobType ? [['Job', [info.jobNumber ? `#${info.jobNumber}` : '', info.jobType].filter(Boolean).join(' · ')]] : []),
  ];
  const boxH = 14 + Math.max(1, facts.length) * 15 + 4;
  doc.rect(M, y, CW, boxH, { fill: '#f8f9fa', stroke: RULE });
  let fy = y + 18;
  for (const [k, v] of facts) {
    doc.text(M + 12, fy, k, { size: 9, color: MUTED });
    doc.text(M + 110, fy, v, { size: 9.5, color: INK });
    fy += 15;
  }
  y += boxH + 20;

  doc.text(M, y + 12, 'In this packet', { size: 11, bold: true, color: INK });
  y += 22;
  if (c.empty) {
    para('Nothing has been invoiced or signed on this job yet.', { color: MUTED });
  } else {
    if (c.invoices.length) row(`Invoices (${c.invoices.length}) with the payments on each`, '', { indent: 8 });
    if (c.estimate) row('Estimate, signed', '', { indent: 8 });
    if (c.pre) row(`${INSPECTION_KINDS.pre} inspection, signed`, '', { indent: 8 });
    if (c.post) row(`${INSPECTION_KINDS.post} inspection, signed`, '', { indent: 8 });
  }

  // ------------------------------------------------------------------------------------------------ invoices
  for (const inv of c.invoices) {
    newPage();
    section(`Invoice #${inv.invoice_number}`, INVOICE_STATUS[inv.status] || '');
    const meta = [
      inv.bill_to_name ? ['Billed to', inv.bill_to_name] : null,
      inv.issued_at ? ['Issued', dayText(inv.issued_at)] : null,
      inv.due_date ? ['Due', dayText(`${inv.due_date}T12:00:00`)] : null,
      inv.po_number ? ['PO number', inv.po_number] : null,
    ].filter(Boolean);
    for (const [k, v] of meta) { ensure(15); doc.text(M, y + 10, k, { size: 9, color: MUTED }); doc.text(M + 90, y + 10, v, { size: 9.5 }); y += 14; }
    if (inv.scope_note) { y += 4; para(inv.scope_note, { size: 9, color: '#343a40' }); }
    y += 8;
    ensure(24);
    doc.rect(M, y, CW, 18, { fill: '#f1f3f5' });
    doc.text(M + 8, y + 12.5, 'Description', { size: 8.5, bold: true, color: MUTED });
    doc.text(M + 330, y + 12.5, 'Qty', { size: 8.5, bold: true, color: MUTED, align: 'right' });
    doc.text(M + 410, y + 12.5, 'Price', { size: 8.5, bold: true, color: MUTED, align: 'right' });
    doc.text(PW - M - 8, y + 12.5, 'Amount', { size: 8.5, bold: true, color: MUTED, align: 'right' });
    y += 22;
    for (const l of inv.lines || []) {
      const lines = wrapText(l.description || '', 270, 9.5, false);
      ensure(lines.length * 12 + 6);
      lines.forEach((t, i) => doc.text(M + 8, y + 10 + i * 12, t, { size: 9.5 }));
      doc.text(M + 330, y + 10, `${qtyText(l.quantity)} ${l.unit && l.unit !== 'each' ? l.unit : ''}`.trim(), { size: 9.5, align: 'right' });
      doc.text(M + 410, y + 10, centsToText(Math.round(Number(l.unit_price) * 100)), { size: 9.5, align: 'right' });
      doc.text(PW - M - 8, y + 10, centsToText(invoiceLineCents(l)), { size: 9.5, align: 'right' });
      y += lines.length * 12 + 4;
      doc.line(M, y, PW - M, y, { color: '#e9ecef', width: 0.5 });
      y += 2;
    }
    y += 6;
    const tot = (k, v, bold = false) => { ensure(15); doc.text(PW - M - 150, y + 10, k, { size: 9.5, bold, color: bold ? INK : '#343a40' }); doc.text(PW - M - 8, y + 10, v, { size: 9.5, bold, align: 'right' }); y += 14; };
    tot('Subtotal', centsToText(inv.subtotal_cents));
    if (inv.minimum_adjustment_cents) tot('Minimum charge top-up', centsToText(inv.minimum_adjustment_cents));
    tot('Total', centsToText(inv.total_cents), true);
    if (inv.credit_cents) tot('Paid on earlier invoice', `-${centsToText(inv.credit_cents)}`);
    if (inv.interest_cents) tot('Interest', centsToText(inv.interest_cents));
    const pays = (inv.payments || []).slice().sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)));
    if (pays.length) {
      y += 10;
      ensure(30);
      doc.text(M, y + 10, 'Payments', { size: 11, bold: true });
      y += 18;
      for (const p of pays) {
        const what = `${dayText(p.received_at)}  ·  ${PAYMENT_METHODS[p.method] || p.method}${p.reference ? ` ${p.reference}` : ''}${p.amount_cents < 0 ? '  ·  refund' : ''}`;
        row(what, centsToText(p.amount_cents), { indent: 8 });
        if (p.tip_cents) row(`Tip ${centsToText(p.tip_cents)}`, '', { indent: 16, size: 8.5, color: MUTED });
      }
    }
    y += 6;
    tot('Paid', centsToText(inv.paid_cents));
    tot(inv.balance_cents > 0 ? 'Balance due' : 'Balance', centsToText(inv.balance_cents), true);
  }

  // ------------------------------------------------------------------------------------------------ signed estimate
  if (c.estimate) {
    const sg = c.estimate.signature;
    newPage();
    section('Estimate, signed', dateText(sg.signed_at));
    ensure(24);
    doc.rect(M, y, CW, 18, { fill: '#f1f3f5' });
    doc.text(M + 8, y + 12.5, 'Description', { size: 8.5, bold: true, color: MUTED });
    doc.text(M + 330, y + 12.5, 'Qty', { size: 8.5, bold: true, color: MUTED, align: 'right' });
    doc.text(M + 410, y + 12.5, 'Price', { size: 8.5, bold: true, color: MUTED, align: 'right' });
    doc.text(PW - M - 8, y + 12.5, 'Amount', { size: 8.5, bold: true, color: MUTED, align: 'right' });
    y += 22;
    for (const l of Array.isArray(sg.lines_snapshot) ? sg.lines_snapshot : []) {
      const lines = wrapText(l.description || '', 270, 9.5, false);
      ensure(lines.length * 12 + 6);
      lines.forEach((t, i) => doc.text(M + 8, y + 10 + i * 12, t, { size: 9.5 }));
      doc.text(M + 330, y + 10, `${qtyText(l.quantity)} ${l.unit && l.unit !== 'each' ? l.unit : ''}`.trim(), { size: 9.5, align: 'right' });
      doc.text(M + 410, y + 10, centsToText(Math.round(Number(l.unit_price) * 100)), { size: 9.5, align: 'right' });
      doc.text(PW - M - 8, y + 10, centsToText(invoiceLineCents(l)), { size: 9.5, align: 'right' });
      y += lines.length * 12 + 4;
      doc.line(M, y, PW - M, y, { color: '#e9ecef', width: 0.5 });
      y += 2;
    }
    y += 6;
    if (Number(sg.minimum_charge) > 0) { ensure(15); doc.text(M + 8, y + 10, `Minimum charge ${centsToText(Math.round(Number(sg.minimum_charge) * 100))} applies`, { size: 8.5, color: MUTED }); y += 14; }
    ensure(18);
    doc.text(PW - M - 150, y + 11, 'Total agreed', { size: 10.5, bold: true });
    doc.text(PW - M - 8, y + 11, centsToText(sg.total_cents), { size: 10.5, bold: true, align: 'right' });
    y += 24;
    if (sg.preferred_times) { para(`Preferred times: ${sg.preferred_times}`, { size: 9, color: '#343a40' }); y += 4; }
    signatureBlock(sigs.get('estimate'), sg.signer_name, sg.signed_at);
  }

  // ------------------------------------------------------------------------------------------------ signed inspections
  for (const kind of ['pre', 'post']) {
    const rec = kind === 'pre' ? c.pre : c.post;
    if (!rec) continue;
    const d = cleanInspection(kind, rec.data);
    newPage();
    section(`${INSPECTION_KINDS[kind]} inspection, signed`, dateText(rec.signed_at));
    for (const r of d.rooms) {
      ensure(60);
      doc.rect(M, y, CW, 18, { fill: '#f1f3f5' });
      doc.text(M + 8, y + 12.5, r.name, { size: 10, bold: true });
      const bits = [r.fiber, r.traffic ? 'High traffic' : '', PRETEST[r.pretest] && r.pretest !== 'not_tested' ? `Pre-test: ${PRETEST[r.pretest]}` : ''].filter(Boolean).join('  ·  ');
      if (bits) doc.text(PW - M - 8, y + 12.5, bits, { size: 8.5, color: MUTED, align: 'right' });
      y += 24;
      if (r.notes) para(r.notes, { size: 9, color: '#343a40', indent: 8 });
      for (const s of r.issues) {
        const res = kind === 'post' && s.result ? `  ·  ${RESULTS[s.result] || ''}` : '';
        row(`${s.type}${s.where ? ` - ${s.where}` : ''}${res}`, '', { indent: 8, size: 9 });
        if (kind === 'post' && s.note) para(s.note, { size: 8.5, color: MUTED, indent: 20 });
      }
      if (!r.issues.length) row('No spots noted', '', { indent: 8, size: 9, color: MUTED });
      y += 6;
    }
    if (d.notes) { para(`Notes: ${d.notes}`, { size: 9 }); y += 4; }
    if (kind === 'post') {
      if (d.drying_hours) row(`Expected drying time about ${d.drying_hours} hours`, '', { size: 9 });
      row(d.walkthrough ? 'Walk-through done with the customer' : 'Walk-through not recorded', '', { size: 9 });
      if (d.comments) para(`Customer comments: ${d.comments}`, { size: 9 });
    }
    y += 8;
    signatureBlock(sigs.get(rec.id), rec.signer_name, rec.signed_at);
  }

  void textWidth;
  return doc.finish();
}

export const packetFileName = (jobNumber) => `job-${jobNumber || 'packet'}-packet.pdf`;
