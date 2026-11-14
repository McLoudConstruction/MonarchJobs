// Printable asset labels: the company logo, the asset number and a QR code, laid out to match an Avery 5163 sheet
// (2 x 4 inch labels, two across and five down, 10 per sheet), so they can be printed on sheets bought at a store, including the
// weatherproof film version. Print at 100% / "actual size", not "fit to page".
//   Page 8.5 x 11 in. Labels 4 x 2 in. Side margin 0.15625 in, gap between columns 0.1875 in, top margin 0.5 in.
import { PdfDoc } from './pdfDoc.js';
import { qrMatrix } from './equipmentLabels.js';
import { assetLink, assetTag, typeLabel } from './assets.js';

const IN = 72;
export const SHEET = { cols: 2, rows: 5, w: 4 * IN, h: 2 * IN, left: 0.15625 * IN, top: 0.5 * IN, gapX: 0.1875 * IN, gapY: 0 };
export const PER_SHEET = SHEET.cols * SHEET.rows;

// Where label number n (0 is the first on a sheet) sits: its top-left corner in points.
export function labelOrigin(n) {
  const i = n % PER_SHEET;
  return { x: SHEET.left + (i % SHEET.cols) * (SHEET.w + SHEET.gapX), y: SHEET.top + Math.floor(i / SHEET.cols) * (SHEET.h + SHEET.gapY) };
}

// assets: [{ id, asset_no, type, label, serial }]; opts: { origin, prefix, business, logo: {bytes,w,h}|null, startAt: 1..10, outline: bool }
// startAt lets a partly used sheet be reused: the first label printed goes in that position.
export function assetLabelsPdf(assets, { origin, prefix, business = '', logo = null, startAt = 1, outline = false }) {
  const doc = new PdfDoc({ title: 'Equipment asset labels' });
  const offset = Math.min(Math.max(Math.floor(startAt) || 1, 1), PER_SHEET) - 1;
  assets.forEach((a, k) => {
    const n = k + offset;
    if (k === 0 || n % PER_SHEET === 0) doc.addPage();
    const { x, y } = labelOrigin(n);
    if (outline) doc.rect(x, y, SHEET.w, SHEET.h, { stroke: '#ced4da' }); // for a test print on plain paper
    const pad = 12;
    const qrSize = SHEET.h - pad * 2; // 120 pt, 1.67 in
    const m = qrMatrix(assetLink(origin, a.id));
    const cell = qrSize / (m.length + 4);
    const qx = x + SHEET.w - pad - qrSize;
    const qy = y + pad;
    doc.rect(qx, qy, qrSize, qrSize, { fill: '#ffffff' });
    m.forEach((row, ry) => row.forEach((on, rx) => { if (on) doc.rect(qx + (rx + 2) * cell, qy + (ry + 2) * cell, cell + 0.15, cell + 0.15, { fill: '#000000' }); }));
    const colW = SHEET.w - pad * 2 - qrSize - 10;
    const tx = x + pad;
    let ty = y + pad;
    if (logo) {
      const k2 = Math.min(colW / logo.w, 40 / logo.h);
      doc.image(logo.bytes, logo.w, logo.h, tx, ty, logo.w * k2, logo.h * k2);
      ty += logo.h * k2 + 6;
    } else if (business) {
      doc.text(tx, ty + 11, business, { size: 11, bold: true, color: '#111111' });
      ty += 20;
    }
    doc.text(tx, y + SHEET.h / 2 + 14, assetTag(prefix, a.asset_no), { size: 28, bold: true, color: '#000000' });
    doc.text(tx, y + SHEET.h / 2 + 30, typeLabel(a.type), { size: 9.5, color: '#343a40' });
    if (a.label) doc.text(tx, y + SHEET.h / 2 + 42, a.label, { size: 9, color: '#495057' });
    if (a.serial) doc.text(tx, y + SHEET.h - pad - 2, `S/N ${a.serial}`, { size: 8, color: '#868e96' });
    doc.text(qx + qrSize / 2, y + SHEET.h - 3, 'Scan', { size: 6.5, color: '#868e96', align: 'center' });
  });
  return doc.finish();
}
