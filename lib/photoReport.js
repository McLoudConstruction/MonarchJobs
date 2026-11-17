// The photo reports: a PDF of a job's pictures for the customer, an insurer or the file. Two layouts:
//   photos       every picture in groups (by folder such as Before / During / After, or by room), two to a row
//   beforeafter  each Before next to its After, one pair to a row, with the room named
// Pure: the picking and grouping functions take plain rows, and renderPhotoReport gets the pictures already as JPEG bytes
// (the browser fetches and shrinks them, see lib/photoReportClient.js). A report never names a staff member, never prints
// where a picture was taken (GPS) and never prints tags. Captions are optional.
import { PdfDoc, textWidth, wrapText } from './pdfDoc.js';
import { PHOTO_KINDS, PHOTO_KIND_KEYS } from './jobDocs.js';

export const MAX_REPORT_PHOTOS = 120; // a PDF this size is about 15 to 25 MB; more than this should be split by folder or room

export const PHOTO_REPORT_KINDS = {
  photos: 'Photo report',
  beforeafter: 'Before & after',
};

const INK = '#212529';
const MUTED = '#6c757d';
const RULE = '#ced4da';
const M = 40;
const PW = 612;
const PH = 792;
const CW = PW - M * 2;
const BOTTOM = PH - 48;
const GAP = 14;

// ------------------------------------------------------------------------------------------------- picking and grouping
// Photos that belong in a report: not archived, and not the original of a marked-up copy (the marked-up one is shown).
export function reportablePhotos(photos) {
  const live = (photos || []).filter((p) => !p.archived_at);
  const replaced = new Set(live.filter((p) => p.derived_from).map((p) => p.derived_from));
  return live.filter((p) => !replaced.has(p.id));
}

const byTaken = (a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime() || String(a.id).localeCompare(String(b.id));
const roomValue = (p) => (p.sketch_id && p.room_key ? `${p.sketch_id}|${p.room_key}` : '');

// options: { kinds: [] (empty = all), room: 'sketch|room' or '' (all), groupBy: 'kind' | 'room' }
// rooms: [{ value, label }] as the job page has them. Returns [{ key, heading, photos[] }], photos oldest first.
export function photoSections(photos, { kinds = [], room = '', groupBy = 'kind' } = {}, rooms = []) {
  const names = new Map((rooms || []).map((r) => [r.value, r.label]));
  const list = reportablePhotos(photos)
    .filter((p) => !kinds.length || kinds.includes(p.kind))
    .filter((p) => !room || roomValue(p) === room)
    .sort(byTaken);
  if (groupBy === 'room') {
    const groups = new Map();
    for (const p of list) {
      const key = roomValue(p);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const order = [...(rooms || []).map((r) => r.value), ''];
    const keys = [...groups.keys()].sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    return keys.map((key) => ({ key: key || 'none', heading: key ? names.get(key) || 'Room' : 'Not in a room', photos: groups.get(key) }));
  }
  return PHOTO_KIND_KEYS
    .map((k) => ({ key: k, heading: PHOTO_KINDS[k], photos: list.filter((p) => p.kind === k) }))
    .filter((s) => s.photos.length);
}

// Before / after pairs. A photo taken with the "take the after" camera is linked to its before (pair_of). Otherwise, in each
// room, the earliest Before is paired with the latest After. Each photo is used once. A pair needs both sides.
// Returns [{ key, room, before, after }] in the order of the rooms, then oldest first.
export function beforeAfterPairs(photos, rooms = [], { room = '' } = {}) {
  const names = new Map((rooms || []).map((r) => [r.value, r.label]));
  const list = reportablePhotos(photos).sort(byTaken);
  const byId = new Map(list.map((p) => [p.id, p]));
  const used = new Set();
  const pairs = [];
  // linked: the after names its before
  for (const a of list.filter((p) => p.kind === 'after' && p.pair_of)) {
    const b = byId.get(a.pair_of);
    if (!b || b.kind !== 'before' || used.has(b.id) || used.has(a.id)) continue;
    used.add(a.id); used.add(b.id);
    pairs.push({ before: b, after: a });
  }
  // unlinked: match inside a room
  const rest = list.filter((p) => !used.has(p.id));
  const rooms2 = new Set(rest.filter((p) => roomValue(p)).map(roomValue));
  for (const rv of rooms2) {
    const befores = rest.filter((p) => p.kind === 'before' && roomValue(p) === rv);
    const afters = rest.filter((p) => p.kind === 'after' && roomValue(p) === rv);
    const n = Math.min(befores.length, afters.length);
    // earliest befores with latest afters, in order
    const bs = befores.slice(0, n);
    const as = afters.slice(afters.length - n);
    for (let i = 0; i < n; i++) pairs.push({ before: bs[i], after: as[i] });
  }
  const order = (rooms || []).map((r) => r.value);
  return pairs
    .map((p) => ({ ...p, key: p.after.id, room: roomValue(p.after) || roomValue(p.before) }))
    .filter((p) => !room || p.room === room)
    .sort((a, b) => {
      const ia = order.indexOf(a.room); const ib = order.indexOf(b.room);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || new Date(a.before.taken_at) - new Date(b.before.taken_at);
    })
    .map((p) => ({ ...p, roomName: p.room ? names.get(p.room) || 'Room' : '' }));
}

// Which reports a job can offer right now, from what it has. Pure, for the Reports tab and the tests.
//   photos: all the job's photos. { moisture, inspection } say whether those reports have anything in them.
export function photoReportAvailability(photos, rooms = []) {
  const n = reportablePhotos(photos).length;
  return { photoCount: n, pairCount: beforeAfterPairs(photos, rooms).length };
}

// ------------------------------------------------------------------------------------------------- the PDF
const dateText = (iso) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
};

// opts: { mode, title, info: { business, phone, email, customer, address, jobNumber, jobType }, sections | pairs,
//         showCaptions, showDates, preparedAt }
// Each picture handed in: { bytes (JPEG), w, h, caption, takenAt, label }. label is the folder or room shown under it.
export function renderPhotoReport(opts = {}) {
  const mode = opts.mode === 'beforeafter' ? 'beforeafter' : 'photos';
  const info = opts.info || {};
  const title = opts.title || 'Photos';
  const showCaptions = opts.showCaptions !== false;
  const showDates = opts.showDates !== false;
  const doc = new PdfDoc({ title: `${PHOTO_REPORT_KINDS[mode]} - ${title}` });
  doc.addPage();
  let y = M;

  const newPage = () => { doc.addPage(); y = M; doc.text(M, y + 8, title, { size: 8, color: MUTED }); y += 22; };
  const ensure = (h) => { if (y + h > BOTTOM) newPage(); };
  const heading = (t, sub) => {
    ensure(70);
    doc.text(M, y + 13, t, { size: 13, bold: true, color: INK });
    if (sub) doc.text(PW - M, y + 13, sub, { size: 8.5, color: MUTED, align: 'right' });
    doc.line(M, y + 19, PW - M, y + 19, { color: RULE, width: 0.75 });
    y += 28;
  };

  // ---- first page: who made it, what it is about
  if (info.business) {
    doc.text(M, y + 10, info.business, { size: 11, bold: true, color: '#343a40' });
    const contact = [info.phone, info.email].filter(Boolean).join('  ·  ');
    if (contact) doc.text(PW - M, y + 10, contact, { size: 8.5, color: MUTED, align: 'right' });
    y += 20;
  }
  doc.text(M, y + 20, mode === 'beforeafter' ? 'Before & After' : 'Photo Report', { size: 22, bold: true, color: INK });
  y += 30;
  doc.text(M, y + 12, title, { size: 12, color: '#343a40' });
  const prepared = (opts.preparedAt || new Date()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  doc.text(PW - M, y + 12, `Prepared ${prepared}`, { size: 9, color: MUTED, align: 'right' });
  y += 26;
  const facts = [
    ...(info.customer ? [['Customer', info.customer]] : []),
    ...(info.address ? [['Property', info.address]] : []),
    ...(info.jobNumber || info.jobType ? [['Job', [info.jobNumber ? `#${info.jobNumber}` : '', info.jobType].filter(Boolean).join(' · ')]] : []),
  ];
  const count = mode === 'beforeafter' ? (opts.pairs || []).length : (opts.sections || []).reduce((n, s) => n + s.photos.length, 0);
  facts.push([mode === 'beforeafter' ? 'Comparisons' : 'Photos', String(count)]);
  const boxH = 14 + facts.length * 15 + 4;
  doc.rect(M, y, CW, boxH, { fill: '#f8f9fa', stroke: RULE });
  let fy = y + 18;
  for (const [k, v] of facts) {
    doc.text(M + 12, fy, k, { size: 9, color: MUTED });
    doc.text(M + 110, fy, v, { size: 9.5, color: INK });
    fy += 15;
  }
  y += boxH + 18;

  // One picture in a box, centered and scaled to fit, with an optional line under it. Returns the height used.
  const cellW = (CW - GAP) / 2;
  const IMG_H = 190;
  const drawPhoto = (p, x, top, w, h, { tag } = {}) => {
    const k = Math.min(w / p.w, h / p.h);
    const iw = p.w * k;
    const ih = p.h * k;
    doc.rect(x, top, w, h, { fill: '#f1f3f5' });
    doc.image(p.bytes, p.w, p.h, x + (w - iw) / 2, top + (h - ih) / 2, iw, ih);
    if (tag) {
      const tw = textWidth(tag, 7.5, true) + 10;
      doc.rect(x + 6, top + 6, tw, 14, { fill: '#212529' });
      doc.text(x + 11, top + 16, tag, { size: 7.5, bold: true, color: '#ffffff' });
    }
  };
  const captionLines = (p, w) => {
    const out = [];
    if (showCaptions && p.caption) out.push(...wrapText(p.caption, w, 8.5, false).slice(0, 3));
    const meta = [p.label, showDates && p.takenAt ? dateText(p.takenAt) : ''].filter(Boolean).join('  ·  ');
    if (meta) out.push({ meta });
    return out;
  };
  const drawCaption = (lines, x, top, w) => {
    let cy = top;
    for (const ln of lines) {
      if (typeof ln === 'string') { doc.text(x, cy + 8, ln, { size: 8.5, color: INK }); }
      else doc.text(x, cy + 8, ln.meta, { size: 7.5, color: MUTED });
      cy += 11;
    }
    return lines.length * 11;
  };

  if (mode === 'photos') {
    for (const section of opts.sections || []) {
      heading(section.heading, `${section.photos.length} photo${section.photos.length === 1 ? '' : 's'}`);
      for (let i = 0; i < section.photos.length; i += 2) {
        const row = section.photos.slice(i, i + 2);
        const caps = row.map((p) => captionLines(p, cellW));
        const rowH = IMG_H + 4 + Math.max(...caps.map((c) => c.length), 0) * 11 + 12;
        ensure(rowH);
        row.forEach((p, j) => {
          const x = M + j * (cellW + GAP);
          drawPhoto(p, x, y, cellW, IMG_H);
          drawCaption(caps[j], x, y + IMG_H + 4, cellW);
        });
        y += rowH;
      }
      y += 6;
    }
  } else {
    const PIC_H = 200;
    for (const pr of opts.pairs || []) {
      const caps = [captionLines(pr.before, cellW), captionLines(pr.after, cellW)];
      const capH = Math.max(...caps.map((c) => c.length), 0) * 11;
      const head = pr.roomName ? 22 : 0;
      const rowH = head + PIC_H + 4 + capH + 14;
      ensure(rowH);
      if (pr.roomName) { doc.text(M, y + 12, pr.roomName, { size: 11, bold: true, color: INK }); }
      drawPhoto(pr.before, M, y + head, cellW, PIC_H, { tag: 'BEFORE' });
      drawPhoto(pr.after, M + cellW + GAP, y + head, cellW, PIC_H, { tag: 'AFTER' });
      drawCaption(caps[0], M, y + head + PIC_H + 4, cellW);
      drawCaption(caps[1], M + cellW + GAP, y + head + PIC_H + 4, cellW);
      y += rowH;
    }
  }

  const n = doc.count;
  for (let i = 0; i < n; i++) doc.text(PW - M, PH - 26, `Page ${i + 1} of ${n}`, { size: 7.5, color: MUTED, align: 'right', page: i });
  return doc.finish();
}
