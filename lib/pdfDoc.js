// A small multi-page PDF writer with no dependencies: text (Helvetica, real selectable text), lines, rectangles, circles,
// and JPEG pictures. Coordinates are in points from the TOP LEFT of the page, y growing downward.
// Text is Latin-1 (WinAnsi); anything else is simplified so a stray symbol can't break the file.

const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

const SIMPLE = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '−': '-', '•': '\xb7', '…': '...', '↑': '', '↓': '', ' ': ' ' };
export function pdfClean(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = SIMPLE[ch] ?? ch;
    for (const d of c) {
      const code = d.charCodeAt(0);
      if (code === 9 || code === 10 || code === 13) out += ' ';
      else if (code >= 32 && code <= 126) out += d;
      else if (code >= 0xa1 && code <= 0xff) out += d;
      else if (code === 0xa0) out += ' ';
      // anything else is dropped
    }
  }
  return out;
}

export function textWidth(s, size, bold = false) {
  const t = pdfClean(s);
  const tab = bold ? W_BOLD : W_REG;
  let w = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    w += c >= 32 && c <= 126 ? tab[c - 32] : c === 0xb0 ? 400 : c === 0xb7 ? 278 : c === 0xd7 ? 584 : 556;
  }
  return (w * size) / 1000;
}

// Breaks text into lines that fit maxW; a word longer than a line is cut.
export function wrapText(s, maxW, size, bold = false) {
  const words = pdfClean(s).split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  const fits = (t) => textWidth(t, size, bold) <= maxW;
  for (let word of words) {
    if (!fits(word)) {
      if (cur) { lines.push(cur); cur = ''; }
      while (!fits(word) && word.length > 1) {
        let n = word.length - 1;
        while (n > 1 && !fits(word.slice(0, n))) n--;
        lines.push(word.slice(0, n));
        word = word.slice(n);
      }
    }
    const next = cur ? `${cur} ${word}` : word;
    if (fits(next)) cur = next;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Cuts a single line to width, ending in "..." when it had to be shortened.
export function clipText(s, maxW, size, bold = false) {
  let t = pdfClean(s);
  if (textWidth(t, size, bold) <= maxW) return t;
  while (t.length > 1 && textWidth(`${t}...`, size, bold) > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}

const num = (n) => (Math.round(n * 100) / 100).toString();
function rgb(hex, stroke = false) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const v = m ? m[1] : '000000';
  const c = [0, 2, 4].map((i) => (parseInt(v.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
  return `${c} ${stroke ? 'RG' : 'rg'}`;
}
const esc = (t) => t.replace(/[\\()]/g, '\\$&');

export class PdfDoc {
  constructor({ width = 612, height = 792, title = '' } = {}) {
    this.w = width;
    this.h = height;
    this.title = title;
    this.pages = [];   // each: string[] of content operators
    this.images = [];  // { bytes, w, h }
    this.pageImages = []; // per page: Set of image indexes
  }
  get count() { return this.pages.length; }
  addPage() {
    this.pages.push([]);
    this.pageImages.push(new Set());
    return this.pages.length - 1;
  }
  get cur() { return this.pages[this.pages.length - 1]; }
  op(s, page = this.pages.length - 1) { this.pages[page].push(s); }

  text(x, y, s, { size = 10, bold = false, color = '#000000', align = 'left', page = this.pages.length - 1 } = {}) {
    const t = pdfClean(s);
    if (!t) return;
    const w = textWidth(t, size, bold);
    const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.op(`BT ${rgb(color)} /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(px)} ${num(this.h - y)} Td (${esc(t)}) Tj ET`, page);
  }
  line(x1, y1, x2, y2, { color = '#000000', width = 0.75, dash = null, page = this.pages.length - 1 } = {}) {
    this.op(`q ${rgb(color, true)} ${num(width)} w ${dash ? `[${dash.map(num).join(' ')}] 0 d` : '[] 0 d'} ${num(x1)} ${num(this.h - y1)} m ${num(x2)} ${num(this.h - y2)} l S Q`, page);
  }
  polyline(points, { color = '#000000', width = 1.25, page = this.pages.length - 1 } = {}) {
    if (points.length < 2) return;
    const path = points.map(([x, y], i) => `${num(x)} ${num(this.h - y)} ${i ? 'l' : 'm'}`).join(' ');
    this.op(`q ${rgb(color, true)} ${num(width)} w 1 J 1 j ${path} S Q`, page);
  }
  rect(x, y, w, h, { fill = null, stroke = null, width = 0.75, page = this.pages.length - 1 } = {}) {
    if (!fill && !stroke) return;
    const paint = fill && stroke ? 'B' : fill ? 'f' : 'S';
    this.op(`q ${fill ? rgb(fill) : ''} ${stroke ? `${rgb(stroke, true)} ${num(width)} w` : ''} ${num(x)} ${num(this.h - y - h)} ${num(w)} ${num(h)} re ${paint} Q`, page);
  }
  circle(cx, cy, r, { fill = null, stroke = null, width = 0.75, page = this.pages.length - 1 } = {}) {
    const k = 0.5523 * r;
    const X = (v) => num(v);
    const Y = (v) => num(this.h - v);
    const path = `${X(cx + r)} ${Y(cy)} m ${X(cx + r)} ${Y(cy - k)} ${X(cx + k)} ${Y(cy - r)} ${X(cx)} ${Y(cy - r)} c ${X(cx - k)} ${Y(cy - r)} ${X(cx - r)} ${Y(cy - k)} ${X(cx - r)} ${Y(cy)} c ${X(cx - r)} ${Y(cy + k)} ${X(cx - k)} ${Y(cy + r)} ${X(cx)} ${Y(cy + r)} c ${X(cx + k)} ${Y(cy + r)} ${X(cx + r)} ${Y(cy + k)} ${X(cx + r)} ${Y(cy)} c`;
    const paint = fill && stroke ? 'B' : fill ? 'f' : 'S';
    this.op(`q ${fill ? rgb(fill) : ''} ${stroke ? `${rgb(stroke, true)} ${num(width)} w` : ''} ${path} ${paint} Q`, page);
  }
  // A baseline JPEG (Uint8Array) of w x h pixels, drawn into the box x, y, width, height.
  image(jpeg, pw, ph, x, y, width, height, page = this.pages.length - 1) {
    let idx = this.images.findIndex((im) => im.bytes === jpeg);
    if (idx < 0) { this.images.push({ bytes: jpeg, w: pw, h: ph }); idx = this.images.length - 1; }
    this.pageImages[page].add(idx);
    this.op(`q ${num(width)} 0 0 ${num(height)} ${num(x)} ${num(this.h - y - height)} cm /Im${idx} Do Q`, page);
  }

  finish() {
    const enc = new TextEncoder();
    const parts = [];
    const offsets = [];
    let pos = 0;
    const push = (bytes) => { parts.push(bytes); pos += bytes.length; };
    const latin1 = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };
    const text = (s) => push(latin1(s));
    const obj = (n, body) => { offsets[n] = pos; text(`${n} 0 obj\n${body}\nendobj\n`); };

    // Object numbers: 1 catalog, 2 pages, 3 regular font, 4 bold font, 5 info, then per page (page, content), then images.
    const nPages = this.pages.length;
    const pageObj = (i) => 6 + i * 2;
    const contentObj = (i) => 7 + i * 2;
    const imageObj = (i) => 6 + nPages * 2 + i;
    const total = 6 + nPages * 2 + this.images.length;

    text('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${nPages} >>`);
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    obj(5, `<< /Title (${esc(pdfClean(this.title))}) /Producer (MonarchJobs) >>`);
    this.pages.forEach((ops, i) => {
      const xo = [...this.pageImages[i]].map((k) => `/Im${k} ${imageObj(k)} 0 R`).join(' ');
      obj(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.w} ${this.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xo ? ` /XObject << ${xo} >>` : ''} >> /Contents ${contentObj(i)} 0 R >>`);
      const content = ops.join('\n');
      const body = latin1(content);
      offsets[contentObj(i)] = pos;
      text(`${contentObj(i)} 0 obj\n<< /Length ${body.length} >>\nstream\n`);
      push(body);
      text('\nendstream\nendobj\n');
    });
    this.images.forEach((im, i) => {
      offsets[imageObj(i)] = pos;
      text(`${imageObj(i)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
      push(im.bytes);
      text('\nendstream\nendobj\n');
    });
    const xref = pos;
    let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let n = 1; n < total; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    text(`${table}trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    void enc;
    const out = new Uint8Array(pos);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }
}
