// The Daily Burn PDF: one row per calendar day with the equipment on site, the hours worked, that day's cost and the running
// total. For the owner. Company details only, no staff names. Pure drawing on a PdfDoc.
import { PdfDoc, wrapText } from './pdfDoc.js';
import { centsToText } from './invoice.js';
import { drawBrandHeader, BRAND } from './reportBrand.js';
import { EQUIPMENT_TYPES } from './equipment.js';

const INK = '#212529';
const MUTED = '#6c757d';
const RULE = '#ced4da';
const M = 40;
const PW = 612;
const PH = 792;
const CW = PW - M * 2;
const BOTTOM = PH - 48;

const dateLong = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dateShort = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const hoursText = (h) => (h ? `${String(h).replace(/\.0+$/, '')} h` : '-');
const unitsText = (units) => units.map((u) => `${u.count} ${(EQUIPMENT_TYPES[u.type]?.code || u.label)}`).join(', ');

// opts: { info, burn (from dailyBurn), preparedAt }
export function renderDailyBurn(opts = {}) {
  const info = opts.info || {};
  const burn = opts.burn;
  const doc = new PdfDoc({ title: `Daily burn - ${[info.address, info.customer].filter(Boolean).join(' ') || 'job'}` });
  doc.addPage();
  let y = M;
  y = drawBrandHeader(doc, info, y, M, PW);
  doc.text(M, y + 20, 'Daily Burn', { size: 22, bold: true, color: INK });
  doc.text(PW - M, y + 20, `Prepared ${dateLong((opts.preparedAt || new Date()).toISOString().slice(0, 10))}`, { size: 9, color: MUTED, align: 'right' });
  y += 38;

  const facts = [
    ...(info.customer ? [['Customer', info.customer]] : []),
    ...(info.address ? [['Property', info.address]] : []),
    ...(info.jobNumber || info.jobType ? [['Job', [info.jobNumber ? `#${info.jobNumber}` : '', info.jobType].filter(Boolean).join(' · ')]] : []),
  ];
  if (!burn || burn.empty) {
    facts.push(['Status', 'No equipment has been placed and no hours logged yet.']);
  } else {
    const t = burn.totals;
    facts.push(['Days', `${burn.days.length} (${dateShort(burn.days[0].date)} to ${dateShort(burn.days[burn.days.length - 1].date)})`]);
    facts.push(['Total so far', `${centsToText(t.totalCents)}  (equipment ${centsToText(t.equipmentCents)}, labor ${centsToText(t.laborCents)})`]);
    facts.push(['Average per day', centsToText(burn.avgCents)]);
    if (burn.peak) facts.push(['Highest day', `${centsToText(burn.peak.dayCents)} on ${dateShort(burn.peak.date)}`]);
  }
  const boxH = 14 + facts.length * 15 + 4;
  doc.rect(M, y, CW, boxH, { fill: BRAND.soft, stroke: RULE });
  let fy = y + 18;
  for (const [k, v] of facts) { doc.text(M + 12, fy, k, { size: 9, color: MUTED }); doc.text(M + 110, fy, v, { size: 9.5, color: INK }); fy += 15; }
  y += boxH + 14;
  if (!burn || burn.empty) return doc.finish();

  if (burn.missing.length) {
    const msg = `No daily cost is set for ${burn.missing.map((t) => EQUIPMENT_TYPES[t]?.label || t).join(', ')}, so those machines count as $0 until it is set on the Costs tab.`;
    for (const ln of wrapText(msg, CW, 9, false)) { doc.text(M, y + 9, ln, { size: 9, color: '#8a1f14' }); y += 12; }
    y += 6;
  }

  const cols = [
    { k: 'date', x: M + 4, w: 78, label: 'Day' },
    { k: 'units', x: M + 86, w: 172, label: 'Equipment on site' },
    { k: 'eq', x: M + 340, w: 60, label: 'Equipment', right: true },
    { k: 'lab', x: M + 400, w: 50, label: 'Labor', right: true },
    { k: 'day', x: M + 458, w: 56, label: 'Day total', right: true },
  ];
  const head = () => {
    doc.rect(M, y, CW, 18, { fill: '#f1f3f5' });
    for (const c of cols) doc.text(c.right ? c.x + c.w : c.x, y + 12.5, c.label, { size: 8, bold: true, color: MUTED, align: c.right ? 'right' : 'left' });
    doc.text(PW - M - 4, y + 12.5, 'Running', { size: 8, bold: true, color: MUTED, align: 'right' });
    y += 22;
  };
  head();
  for (const d of burn.days) {
    const lines = wrapText(unitsText(d.units) || 'none', cols[1].w, 9, false);
    const rowH = Math.max(15, lines.length * 11 + 4);
    if (y + rowH > BOTTOM) { doc.addPage(); y = M; doc.text(M, y + 8, 'Daily Burn', { size: 8, color: MUTED }); y += 22; head(); }
    doc.text(cols[0].x, y + 10, dateShort(d.date), { size: 9, color: INK });
    lines.forEach((ln, i) => doc.text(cols[1].x, y + 10 + i * 11, ln, { size: 9, color: d.units.length ? INK : MUTED }));
    doc.text(cols[2].x + cols[2].w, y + 10, centsToText(d.equipmentCents), { size: 9, align: 'right' });
    doc.text(cols[3].x + cols[3].w, y + 10, d.laborCents ? `${centsToText(d.laborCents)}` : '-', { size: 9, align: 'right' });
    doc.text(cols[4].x + cols[4].w, y + 10, centsToText(d.dayCents), { size: 9, bold: true, align: 'right' });
    doc.text(PW - M - 4, y + 10, centsToText(d.runningCents), { size: 9, color: MUTED, align: 'right' });
    if (d.laborHours) doc.text(cols[3].x + cols[3].w, y + 20, hoursText(d.laborHours), { size: 7.5, color: MUTED, align: 'right' });
    const h = d.laborHours ? Math.max(rowH, 24) : rowH;
    y += h;
    doc.line(M, y, PW - M, y, { color: '#e9ecef', width: 0.5 });
  }
  y += 10;
  if (y + 40 > BOTTOM) { doc.addPage(); y = M; }
  doc.rect(M, y, CW, 2, { fill: BRAND.color });
  doc.text(M + 4, y + 20, 'Total', { size: 11, bold: true });
  doc.text(PW - M - 4, y + 20, centsToText(burn.totals.totalCents), { size: 11, bold: true, align: 'right' });
  doc.text(M + 4, y + 36, 'Equipment is counted in calendar days on site. Labor is the hours logged times the hourly cost each entry was made with. Purchases are not included.', { size: 7.5, color: MUTED });
  return doc.finish();
}

export const dailyBurnFileName = (jobNumber) => `job-${jobNumber || 'report'}-daily-burn.pdf`;
