// QR labels for equipment: stick one on each machine, and scanning it with the phone camera opens the job on that unit, so a
// tech can pick it up, move it or read it without hunting through the plan. Pure; the PDF is drawn here with no extra files.
import QRCode from 'qrcode';
import { PdfDoc } from './pdfDoc.js';
import { EQUIPMENT_TYPES, unitCode } from './equipment.js';

// The link a label holds. The job page reads ?unit= and opens the Moisture tab on that unit.
export const unitLink = (origin, jobId, unitId) => `${String(origin).replace(/\/+$/, '')}/jobs/${jobId}?unit=${encodeURIComponent(unitId)}#moisture`;

// The QR as rows of booleans.
export function qrMatrix(text) {
  const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = q.modules.size;
  const rows = [];
  for (let y = 0; y < n; y++) { const r = []; for (let x = 0; x < n; x++) r.push(!!q.modules.get(x, y)); rows.push(r); }
  return rows;
}

const PW = 612; const PH = 792;
const COLS = 2; const ROWS = 5; const MX = 36; const MY = 36;
const LW = (PW - MX * 2) / COLS; const LH = (PH - MY * 2) / ROWS;

// A sheet of labels, two across and five down. units: the plan's equipment; info: { origin, jobId, jobNumber }
export function equipmentLabelsPdf(units, { origin, jobId, jobNumber = '' }) {
  const doc = new PdfDoc({ title: 'Equipment labels' });
  units.forEach((u, i) => {
    const slot = i % (COLS * ROWS);
    if (slot === 0) doc.addPage();
    const x0 = MX + (slot % COLS) * LW;
    const y0 = MY + Math.floor(slot / COLS) * LH;
    doc.rect(x0 + 4, y0 + 4, LW - 8, LH - 8, { stroke: '#adb5bd' });
    const m = qrMatrix(unitLink(origin, jobId, u.id));
    const size = LH - 36;
    const cell = size / (m.length + 4); // two-module quiet zone each side
    const qx = x0 + 14; const qy = y0 + (LH - size) / 2;
    doc.rect(qx, qy, size, size, { fill: '#ffffff' });
    m.forEach((row, ry) => row.forEach((on, rx) => { if (on) doc.rect(qx + (rx + 2) * cell, qy + (ry + 2) * cell, cell + 0.15, cell + 0.15, { fill: '#000000' }); }));
    const tx = qx + size + 14;
    const t = EQUIPMENT_TYPES[u.t] || EQUIPMENT_TYPES.other;
    doc.text(tx, y0 + LH / 2 - 8, unitCode(u), { size: 26, bold: true, color: '#111111' });
    doc.text(tx, y0 + LH / 2 + 10, t.label, { size: 9, color: '#495057' });
    if (u.label) doc.text(tx, y0 + LH / 2 + 22, u.label, { size: 9, color: '#495057' });
    if (jobNumber) doc.text(tx, y0 + LH / 2 + 36, `Job #${jobNumber}`, { size: 9, color: '#495057' });
    doc.text(tx, y0 + LH - 14, 'Scan to open this unit', { size: 7.5, color: '#868e96' });
  });
  return doc.finish();
}
