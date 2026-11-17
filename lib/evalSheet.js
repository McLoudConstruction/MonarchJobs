// The multi-family carpet evaluation sheet (the paper "Eval Sheet"): one sheet per unit.
// Stored as one JSON document per sheet (job_eval_sheets.data). Pure, so it can be tested.
//
//   { complex, building, unit, date: 'YYYY-MM-DD', size: '' | '1' | '2' | '3' | '4', extra_rooms: n,
//     services: { <key>: { on, qty, price } }, others: [{ on, label, amount }, ...],
//     notes, replacement, photo_ids: [photo id, ...] }   (photo_ids are pictures of a paper copy)

// Base price by bedroom count, and each additional room (prices on the printed sheet).
export const SIZES = [
  { key: '1', label: '1 Bedroom', price: 60 },
  { key: '2', label: '2 Bedroom', price: 80 },
  { key: '3', label: '3 Bedroom', price: 100 },
  { key: '4', label: '4 Bedroom', price: 120 },
];
export const EXTRA_ROOM_PRICE = 25;

// Add-on services. `unit` is what the quantity counts. `range` marks a price that varies: the tech enters the
// price for that unit (it starts at the low end of the range).
export const ADDONS = [
  { key: 'prevac', label: 'Pre Vacuum', price: 10, unit: 'room', note: '$10 per room' },
  { key: 'red_stain', label: 'Red Stain Removal', price: 15, unit: 'spot', note: '$15 per spot' },
  { key: 'urine', label: 'Urine Extraction', price: 50, unit: 'room', note: '$50 per room' },
  { key: 'smoke', label: 'Smoke Off Treatment', price: 75, unit: 'each', note: '$75' },
  { key: 'stretch', label: 'Carpet Stretch', price: 50, unit: 'room', range: [50, 75], note: '$50-75 per room' },
  { key: 'patch', label: 'Carpet Patch', price: 35, unit: 'each', range: [35, 150], open: true, note: '$35-150+' },
  { key: 'spot_removal', label: 'Excessive Spot Removal', price: 30, unit: 'spot', note: '$30 per spot' },
];
export const OTHER_LINES = 2;

const MAX_QTY = 99;
const MAX_AMOUNT = 100000;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n * 100) / 100, max) : 0;
};
const qty = (v) => Math.min(Math.max(Math.round(Number(v) || 0), 0), MAX_QTY);
const cents = (n) => Math.round(n * 100) / 100;

export function blankEval(defaults = {}) {
  return cleanEval({
    complex: defaults.complex || '',
    building: defaults.building || '',
    unit: defaults.unit || '',
    date: defaults.date || '',
  });
}

// Reads whatever is stored and returns a safe document.
export function cleanEval(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const svc = d.services && typeof d.services === 'object' ? d.services : {};
  const services = {};
  for (const a of ADDONS) {
    const s = svc[a.key] && typeof svc[a.key] === 'object' ? svc[a.key] : {};
    const on = !!s.on;
    services[a.key] = {
      on,
      qty: on ? Math.max(qty(s.qty), 1) : qty(s.qty),
      price: s.price === undefined || s.price === null || s.price === '' ? a.price : num(s.price, MAX_AMOUNT),
    };
  }
  const others = Array.from({ length: OTHER_LINES }, (_, i) => {
    const o = Array.isArray(d.others) && d.others[i] && typeof d.others[i] === 'object' ? d.others[i] : {};
    return { on: !!o.on, label: str(o.label, 80), amount: num(o.amount, MAX_AMOUNT) };
  });
  return {
    complex: str(d.complex, 120),
    building: str(d.building, 30),
    unit: str(d.unit, 30),
    date: /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : '',
    size: SIZES.some((s) => s.key === d.size) ? d.size : '',
    extra_rooms: qty(d.extra_rooms),
    services,
    others,
    notes: str(d.notes, 600),
    replacement: !!d.replacement,
    photo_ids: (Array.isArray(d.photo_ids) ? d.photo_ids : []).filter((x) => typeof x === 'string').slice(0, 30),
  };
}

// The priced lines and the total. [{ key, label, detail, amount }]
export function evalLines(raw) {
  const d = cleanEval(raw);
  const lines = [];
  const size = SIZES.find((s) => s.key === d.size);
  if (size) lines.push({ key: `size${size.key}`, label: size.label, detail: '', amount: size.price });
  if (d.extra_rooms > 0) {
    lines.push({ key: 'extra', label: 'Additional room(s)', detail: `${d.extra_rooms} x $${EXTRA_ROOM_PRICE}`, amount: cents(d.extra_rooms * EXTRA_ROOM_PRICE) });
  }
  for (const a of ADDONS) {
    const s = d.services[a.key];
    if (!s.on) continue;
    lines.push({ key: a.key, label: a.label, detail: `${s.qty} x $${s.price}`, amount: cents(s.qty * s.price) });
  }
  d.others.forEach((o, i) => {
    if (o.on && (o.label || o.amount)) lines.push({ key: `other${i}`, label: o.label || 'Other', detail: '', amount: o.amount });
  });
  return lines;
}

export function evalTotal(raw) {
  return cents(evalLines(raw).reduce((sum, l) => sum + l.amount, 0));
}

// "B12 / Unit 204 - 2 Bedroom - $140.00", for the list of sheets on a job.
export function evalTitle(raw) {
  const d = cleanEval(raw);
  const where = [d.building && `Bldg ${d.building}`, d.unit && `Unit ${d.unit}`].filter(Boolean).join(' / ');
  const size = SIZES.find((s) => s.key === d.size)?.label || '';
  return [where || 'New sheet', size].filter(Boolean).join(' - ');
}

// Sum across a job's sheets.
export function evalJobTotal(sheets) {
  return cents(sheets.reduce((sum, s) => sum + evalTotal(s.data), 0));
}

export const fmtMoney = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
