// A one-page PDF around a JPEG, written by hand so the sketch can export a PDF without a library.
// jpeg: Uint8Array of a baseline JPEG. w, h: its size in pixels. Returns a Uint8Array.
const LETTER = [612, 792];

function pdfText(s) {
  return String(s || '').replace(/[^\x20-\x7e]/g, '').replace(/[\\()]/g, '\\$&').slice(0, 90);
}

export function jpegToPdf(jpeg, w, h, title = '') {
  const landscape = w > h;
  const [pw, ph] = landscape ? [LETTER[1], LETTER[0]] : LETTER;
  const margin = 36;
  const head = title ? 22 : 0;
  const boxW = pw - margin * 2;
  const boxH = ph - margin * 2 - head;
  const k = Math.min(boxW / w, boxH / h);
  const iw = +(w * k).toFixed(2);
  const ih = +(h * k).toFixed(2);
  const ix = +((pw - iw) / 2).toFixed(2);
  const iy = +(margin + (boxH - ih) / 2).toFixed(2);
  const content = `${title ? `BT /F1 13 Tf ${margin} ${ph - margin - 12} Td (${pdfText(title)}) Tj ET\n` : ''}q ${iw} 0 0 ${ih} ${ix} ${iy} cm /Im0 Do Q\n`;

  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let pos = 0;
  const push = (bytes) => { parts.push(bytes); pos += bytes.length; };
  const text = (s) => push(enc.encode(s));
  const obj = (n, body) => { offsets[n] = pos; text(`${n} 0 obj\n${body}\nendobj\n`); };

  text('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = pos;
  text(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  text('\nendstream\nendobj\n');
  obj(5, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`);
  obj(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const xref = pos;
  let table = 'xref\n0 7\n0000000000 65535 f \n';
  for (let n = 1; n <= 6; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  text(`${table}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
