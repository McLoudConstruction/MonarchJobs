// The look every PDF the company hands out shares: logo (or the company name) at the top left, contact lines at the right,
// and a rule in the brand color. Pure drawing on a PdfDoc, so each report just calls drawBrandHeader first.
// Never prints a staff name: only the company's own details.
import { textWidth } from './pdfDoc.js';

export const BRAND = { color: '#0b7a73', soft: '#e7f4f3', ink: '#212529', muted: '#6c757d' };

// info: { business, phone, email, logo: { bytes, w, h } | null }. Returns the y just below the header.
export function drawBrandHeader(doc, info = {}, y, M, PW) {
  const logo = info.logo && info.logo.bytes ? info.logo : null;
  const contact = [info.phone, info.email].filter(Boolean);
  let h = 0;
  if (logo) {
    const k = Math.min(150 / logo.w, 40 / logo.h);
    const w = logo.w * k;
    const ih = logo.h * k;
    doc.image(logo.bytes, logo.w, logo.h, M, y, w, ih);
    h = ih;
  } else if (info.business) {
    doc.text(M, y + 15, info.business, { size: 16, bold: true, color: BRAND.color });
    h = 20;
  }
  // right side: the company name (when a logo stands in for it) and how to reach it
  const lines = [...(logo && info.business ? [{ t: info.business, bold: true, size: 10 }] : []), ...contact.map((t) => ({ t, size: 8.5 }))];
  lines.forEach((l, i) => doc.text(PW - M, y + 10 + i * 12, l.t, { size: l.size, bold: !!l.bold, color: l.bold ? BRAND.ink : BRAND.muted, align: 'right' }));
  h = Math.max(h, lines.length * 12);
  void textWidth;
  if (!logo && !info.business && !lines.length) return y;
  doc.rect(M, y + h + 8, PW - M * 2, 2.5, { fill: BRAND.color });
  return y + h + 22;
}
