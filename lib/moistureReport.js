// The customer-facing moisture report: a PDF showing how a loss dried, from the first reading to dry.
// buildReport(plan) works the numbers out (pure, tested); renderMoistureReport(plan, opts) lays them out as a PDF.
import { PdfDoc, clipText, textWidth, wrapText } from './pdfDoc.js';
import { hitRoom, roomTitle } from './sketch.js';
import { dateText, dayName } from './moistureDays.js';
import { MOISTURE_COLORS, MOISTURE_MATERIALS, MOISTURE_SURFACES, MOISTURE_TYPES, POINT_KINDS, fmtReading, goalFor, gpp, measuredStandard, moistureCounts, sortedReadings } from './moisture.js';
import { moistureLogRows } from './moistureLog.js';

const fullDate = (key) => {
  const d = new Date(`${key}T12:00:00`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
};

export function roomLabel(room) {
  if (!room) return 'Outside the rooms';
  const t = roomTitle(room);
  return room.num && !/^Room \d+$/.test(t) ? `#${room.num} ${t}` : t;
}

// What a point is made of, e.g. "Drywall, wall 2 ft".
export function pointWhat(p) {
  const mat = MOISTURE_MATERIALS[p.material] || '';
  const surf = (MOISTURE_SURFACES[p.surface] || '').toLowerCase();
  const h = p.surface === 'wall' && p.h != null ? ` ${fmtReading(p.h)} ft` : '';
  return `${mat}, ${surf}${h}`;
}

// Everything the report says, worked out from a plan.
export function buildReport(plan) {
  const days = plan.days || [];
  const points = (plan.moisture || []).filter((p) => p.kind !== 'air' && p.kind !== 'standard');
  const dayIdx = new Map(days.map((d, i) => [d.id, i]));

  const rows = points.map((p) => {
    const goal = goalFor(plan, p);
    const cells = days.map(() => null);
    for (const r of sortedReadings(p)) { // later readings on a day replace earlier ones
      const i = dayIdx.get(r.day);
      if (i != null && r.val != null) cells[i] = r.val;
    }
    const read = cells.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
    const lastI = read.length ? read[read.length - 1] : -1;
    const last = lastI >= 0 ? cells[lastI] : null;
    let state = 'none';
    if (last != null) state = goal == null ? 'unset' : last <= goal ? 'dry' : 'wet';
    // Dry since: the first day of the unbroken run of dry readings that ends today
    let dryIdx = null;
    if (state === 'dry') {
      dryIdx = lastI;
      for (let k = read.length - 2; k >= 0 && cells[read[k]] <= goal; k--) dryIdx = read[k];
    }
    const first = read.length ? cells[read[0]] : null;
    const room = hitRoom(plan, p.x, p.y);
    return { p, room, goal, cells, first, last, state, dryIdx, dryDay: dryIdx == null ? null : days[dryIdx] };
  });

  // Group by room, in room-number order; points outside every room go last
  const groups = [];
  const byRoom = new Map();
  for (const r of rows) {
    const key = r.room ? r.room.id : '_';
    if (!byRoom.has(key)) { const g = { key, room: r.room, name: roomLabel(r.room), rows: [] }; byRoom.set(key, g); groups.push(g); }
    byRoom.get(key).rows.push(r);
  }
  groups.sort((a, b) => (a.room ? a.room.num || 0 : 1e9) - (b.room ? b.room.num || 0 : 1e9));
  for (const g of groups) {
    g.rows.sort((a, b) => a.p.n - b.p.n);
    const tracked = g.rows.filter((r) => r.state !== 'none');
    g.dry = g.rows.filter((r) => r.state === 'dry').length;
    g.wet = g.rows.filter((r) => r.state === 'wet').length;
    g.allDry = g.rows.length > 0 && g.dry === g.rows.length;
    g.dryIdx = g.allDry ? Math.max(...g.rows.map((r) => r.dryIdx)) : null;
    g.dryDay = g.dryIdx == null ? null : days[g.dryIdx];
    g.tracked = tracked.length;
  }

  const counts = moistureCounts(plan);
  const allDry = rows.length > 0 && rows.every((r) => r.state === 'dry');
  const dryIdx = allDry ? Math.max(...rows.map((r) => r.dryIdx)) : null;
  const lastDay = days.length ? days[days.length - 1] : null;

  // Which goal each material is held to, and where it came from
  const standards = [];
  const seen = new Set();
  for (const r of rows) {
    if (r.goal == null) continue;
    const src = r.p.goal != null ? 'point' : measuredStandard(plan, r.p.material, r.p.type) != null ? 'measured' : 'entered';
    const key = `${r.p.material}|${r.p.type}|${r.goal}|${src}`;
    if (seen.has(key)) continue;
    seen.add(key);
    standards.push({ material: MOISTURE_MATERIALS[r.p.material], type: r.p.type, scale: MOISTURE_TYPES[r.p.type].short.trim(), goal: r.goal, source: src, points: [r.p.n] });
  }
  for (const s of standards) {
    s.points = rows.filter((r) => r.goal === s.goal && MOISTURE_MATERIALS[r.p.material] === s.material && r.p.type === s.type && (r.p.goal != null ? 'point' : measuredStandard(plan, r.p.material, r.p.type) != null ? 'measured' : 'entered') === s.source).map((r) => r.p.n);
  }
  const refs = (plan.moisture || []).filter((p) => p.kind === 'standard').map((p) => {
    const rd = sortedReadings(p);
    const l = rd.length ? rd[rd.length - 1] : null;
    return { n: p.n, room: roomLabel(hitRoom(plan, p.x, p.y)), material: MOISTURE_MATERIALS[p.material], scale: MOISTURE_TYPES[p.type].short.trim(), val: l && l.val != null ? l.val : null };
  });

  // Air readings, newest day last
  const air = [];
  for (const p of plan.moisture || []) {
    if (p.kind !== 'air') continue;
    const room = roomLabel(hitRoom(plan, p.x, p.y));
    for (const r of sortedReadings(p)) {
      const g = gpp(r.temp, r.rh);
      air.push({ at: Date.parse(r.at), n: p.n, room, day: dayName(days, r.day), date: new Date(r.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), rh: r.rh, temp: r.temp, gpp: g == null ? null : Math.round(g) });
    }
  }
  air.sort((a, b) => (a.at - b.at) || (a.n - b.n));

  return {
    days, rows, groups, counts, allDry, dryDay: dryIdx == null ? null : days[dryIdx], lastDay, standards, refs, air,
    start: days[0] || null, hasData: rows.some((r) => r.last != null),
  };
}

// A round upper bound and tick step for a chart axis.
export function niceScale(max) {
  const m = Math.max(max, 1);
  const steps = [1, 2, 5, 10, 20, 25, 50, 100];
  const step = steps.find((s) => m / s <= 5) || 100;
  return { max: Math.ceil(m / step) * step, step };
}

const INK = '#212529';
const MUTED = '#6c757d';
const RULE = '#ced4da';
const PALETTE = ['#1c7ed6', '#d9480f', '#2b8a3e', '#7048e8', '#c2255c', '#0c8599', '#e67700', '#495057'];
const TINT = { dry: '#ebfbee', wet: '#fff4e6' };
const M = 40;            // page margin
const PW = 612;
const PH = 792;
const CW = PW - M * 2;   // content width
const BOTTOM = PH - 48;

// opts: { title, planImage: { bytes, w, h } | null, preparedAt: Date }
export function renderMoistureReport(plan, opts = {}) {
  const rep = buildReport(plan);
  const title = opts.title || 'Moisture report';
  const doc = new PdfDoc({ title: `Moisture report - ${title}` });
  doc.addPage();
  let y = M;

  const newPage = () => { doc.addPage(); y = M; doc.text(M, y + 8, title, { size: 8, color: MUTED }); y += 22; };
  const ensure = (h) => { if (y + h > BOTTOM) newPage(); };
  const heading = (t, sub) => {
    ensure(40);
    doc.text(M, y + 13, t, { size: 13, bold: true, color: INK });
    if (sub) doc.text(PW - M, y + 13, sub, { size: 8.5, color: MUTED, align: 'right' });
    doc.line(M, y + 19, PW - M, y + 19, { color: RULE, width: 0.75 });
    y += 28;
  };

  // A table. cols: [{ w, head, align }]; rows: arrays of string | { t, color, fill, bold }. Header repeats on a new page.
  const table = (cols, trs, { size = 8, head = size, lineH = size + 2.5, pad = 3 } = {}) => {
    const drawHead = () => {
      const lines = cols.map((c) => String(c.head || '').split('\n').flatMap((part) => wrapText(part, c.w - pad * 2, head, true)));
      const h = Math.max(...lines.map((l) => l.length), 1) * (head + 2) + pad * 2;
      ensure(h + 24);
      doc.rect(M, y, CW, h, { fill: '#f1f3f5' });
      let x = M;
      cols.forEach((c, i) => {
        lines[i].forEach((ln, k) => doc.text(c.align === 'right' ? x + c.w - pad : c.align === 'center' ? x + c.w / 2 : x + pad, y + pad + head + k * (head + 2) - 1, ln, { size: head, bold: true, color: '#495057', align: c.align || 'left' }));
        x += c.w;
      });
      y += h;
    };
    drawHead();
    for (const tr of trs) {
      const cells = tr.map((c) => (typeof c === 'object' && c ? c : { t: c }));
      const wrapped = cells.map((c, i) => wrapText(c.t == null ? '' : String(c.t), cols[i].w - pad * 2, size, !!c.bold));
      const h = Math.max(...wrapped.map((l) => l.length), 1) * lineH + pad * 2 - 1;
      if (y + h > BOTTOM) { newPage(); drawHead(); }
      let x = M;
      cells.forEach((c, i) => {
        if (c.fill) doc.rect(x, y, cols[i].w, h, { fill: c.fill });
        wrapped[i].forEach((ln, k) => {
          const al = cols[i].align || 'left';
          doc.text(al === 'right' ? x + cols[i].w - pad : al === 'center' ? x + cols[i].w / 2 : x + pad, y + pad + size + k * lineH - 1, ln, { size, bold: !!c.bold, color: c.color || INK, align: al });
        });
        x += cols[i].w;
      });
      doc.line(M, y + h, PW - M, y + h, { color: '#e9ecef', width: 0.5 });
      y += h;
    }
    y += 10;
  };

  // ---- page 1: summary -------------------------------------------------------------------------------------------------
  doc.text(M, y + 20, 'Moisture Monitoring Report', { size: 22, bold: true, color: INK });
  y += 30;
  doc.text(M, y + 12, title, { size: 12, color: '#343a40' });
  const prepared = (opts.preparedAt || new Date()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  doc.text(PW - M, y + 12, `Prepared ${prepared}`, { size: 9, color: MUTED, align: 'right' });
  y += 26;

  const total = rep.rows.length;
  const nDry = rep.rows.filter((r) => r.state === 'dry').length;
  const nWet = rep.rows.filter((r) => r.state === 'wet').length;
  let status;
  let statusColor = INK;
  if (!rep.hasData) status = 'No readings have been recorded yet.';
  else if (rep.allDry) { status = `All ${total} moisture point${total === 1 ? ' is' : 's are'} at or below the dry standard${rep.dryDay ? `, reached ${dayName(rep.days, rep.dryDay.id)} (${fullDate(rep.dryDay.date)})` : ''}.`; statusColor = MOISTURE_COLORS.dry; }
  else { status = `${nDry} of ${total} moisture point${total === 1 ? ' is' : 's are'} dry as of ${rep.lastDay ? fullDate(rep.lastDay.date) : 'the latest reading'}; ${nWet} still wet.`; statusColor = nWet ? MOISTURE_COLORS.wet : INK; }

  const facts = [
    ['Loss first documented', rep.start ? fullDate(rep.start.date) : '-'],
    ['Monitoring period', rep.start && rep.lastDay ? `${dateText(rep.start.date)} to ${fullDate(rep.lastDay.date)} (${rep.days.length} day${rep.days.length === 1 ? '' : 's'})` : '-'],
    ['Points monitored', `${total} moisture point${total === 1 ? '' : 's'}${rep.counts.standards ? `, ${rep.counts.standards} dry standard reference${rep.counts.standards === 1 ? '' : 's'}` : ''}${rep.counts.air ? `, ${rep.counts.air} air point${rep.counts.air === 1 ? '' : 's'}` : ''}`],
  ];
  const boxH = 18 + facts.length * 15 + wrapText(status, CW - 24, 10.5, true).length * 14 + 10;
  doc.rect(M, y, CW, boxH, { fill: '#f8f9fa', stroke: RULE });
  let fy = y + 18;
  for (const [k, v] of facts) {
    doc.text(M + 12, fy, k, { size: 9, color: MUTED });
    doc.text(M + 140, fy, v, { size: 9.5, color: INK });
    fy += 15;
  }
  for (const ln of wrapText(status, CW - 24, 10.5, true)) { doc.text(M + 12, fy + 4, ln, { size: 10.5, bold: true, color: statusColor }); fy += 14; }
  y += boxH + 14;

  // The plan, as of the latest day, with a legend
  if (opts.planImage) {
    const { bytes, w, h } = opts.planImage;
    const maxH = 300;
    const k = Math.min(CW / w, maxH / h);
    const iw = w * k;
    const ih = h * k;
    doc.text(M, y + 9, `Floor plan${rep.lastDay ? `, as of ${dayName(rep.days, rep.lastDay.id)} (${dateText(rep.lastDay.date)})` : ''}`, { size: 9, bold: true, color: '#495057' });
    y += 14;
    doc.rect(M, y, CW, ih + 8, { stroke: RULE });
    doc.image(bytes, w, h, M + (CW - iw) / 2, y + 4, iw, ih);
    y += ih + 8 + 6;
    let lx = M;
    const legend = [['Dry', MOISTURE_COLORS.dry, 'c'], ['Wet', MOISTURE_COLORS.wet, 'c'], ['No standard set', MOISTURE_COLORS.unset, 'c'], ['Not read that day', MOISTURE_COLORS.none, 'c'], ['Dry standard', MOISTURE_COLORS.standard, 's'], ['Air', MOISTURE_COLORS.air, 'd']];
    for (const [t, c, shape] of legend) {
      if (shape === 'c') doc.circle(lx + 4, y + 5, 4, { fill: c });
      else if (shape === 's') doc.rect(lx, y + 1, 8, 8, { fill: c });
      else { doc.line(lx + 4, y, lx + 8.5, y + 5, { color: c, width: 2.2 }); doc.line(lx + 8.5, y + 5, lx + 4, y + 10, { color: c, width: 2.2 }); doc.line(lx + 4, y + 10, lx - 0.5, y + 5, { color: c, width: 2.2 }); doc.line(lx - 0.5, y + 5, lx + 4, y, { color: c, width: 2.2 }); }
      doc.text(lx + 12, y + 8, t, { size: 8, color: '#495057' });
      lx += 12 + textWidth(t, 8) + 16;
    }
    y += 22;
  }

  // Room by room
  if (rep.groups.length) {
    heading('Status by room');
    table(
      [{ w: 190, head: 'Room' }, { w: 60, head: 'Points', align: 'center' }, { w: 60, head: 'Dry', align: 'center' }, { w: 60, head: 'Wet', align: 'center' }, { w: CW - 370, head: 'Result' }],
      rep.groups.map((g) => [
        { t: g.name, bold: true },
        String(g.rows.length), String(g.dry), String(g.wet),
        g.allDry ? { t: `Dry ${g.dryDay ? `${dayName(rep.days, g.dryDay.id)}, ${dateText(g.dryDay.date)}` : ''}`, color: MOISTURE_COLORS.dry, bold: true, fill: TINT.dry } : g.tracked ? { t: 'Still drying', color: MOISTURE_COLORS.wet, bold: true, fill: TINT.wet } : { t: 'No readings yet', color: MUTED },
      ]),
      { size: 9, lineH: 12 },
    );
  }

  // ---- by room, day by day ----------------------------------------------------------------------------------------------
  if (rep.groups.length) {
    newPage();
    heading('Drying progress by day', 'Reading at each point, last reading of each day');
    const DAYCOLS = 7;
    const DW = 40;
    for (const g of rep.groups) {
      const chunks = [];
      for (let i = 0; i < Math.max(rep.days.length, 1); i += DAYCOLS) chunks.push([i, Math.min(i + DAYCOLS, rep.days.length)]);
      ensure(60);
      doc.text(M, y + 10, g.name, { size: 10.5, bold: true, color: INK });
      doc.text(PW - M, y + 10, g.allDry ? `Dry ${g.dryDay ? dateText(g.dryDay.date) : ''}` : `${g.dry} of ${g.rows.length} dry`, { size: 9, bold: true, color: g.allDry ? MOISTURE_COLORS.dry : MOISTURE_COLORS.wet, align: 'right' });
      y += 16;
      chunks.forEach(([a, b], ci) => {
        const n = b - a;
        const last = ci === chunks.length - 1;
        const fixed = 28 + 52 + (last ? 70 : 0);
        const cols = [{ w: 28, head: 'Pt' }, { w: CW - fixed - n * DW, head: 'Material and surface' }, { w: 52, head: 'Dry goal', align: 'center' }];
        for (let i = a; i < b; i++) cols.push({ w: DW, head: `${dayName(rep.days, rep.days[i].id)}\n${dateText(rep.days[i].date)}`, align: 'center' });
        if (last) cols.push({ w: 70, head: 'Dry on', align: 'center' });
        const trs = g.rows.map((r) => {
          const row = [{ t: String(r.p.n), bold: true }, `${pointWhat(r.p)} (${MOISTURE_TYPES[r.p.type].short.trim()})`, r.goal == null ? { t: 'not set', color: MUTED } : { t: `${fmtReading(r.goal)} or less`, color: '#495057' }];
          for (let i = a; i < b; i++) {
            const v = r.cells[i];
            if (v == null) row.push({ t: '-', color: '#adb5bd' });
            else if (r.goal == null) row.push(fmtReading(v));
            else row.push(v <= r.goal ? { t: fmtReading(v), color: MOISTURE_COLORS.dry, fill: TINT.dry, bold: true } : { t: fmtReading(v), color: MOISTURE_COLORS.wet, fill: TINT.wet, bold: true });
          }
          if (last) row.push(r.state === 'dry' && r.dryDay ? { t: `${dayName(rep.days, r.dryDay.id)}, ${dateText(r.dryDay.date)}`, color: MOISTURE_COLORS.dry } : r.state === 'wet' ? { t: 'Still wet', color: MOISTURE_COLORS.wet } : { t: r.state === 'unset' ? 'No goal' : '-', color: MUTED });
          return row;
        });
        table(cols, trs, { size: 8 });
      });
    }
    doc.text(M, y + 2, 'Green: at or below the dry goal. Orange: above it.', { size: 8, color: MUTED });
    y += 14;
  }

  // ---- drying curves -----------------------------------------------------------------------------------------------------
  const chartGroups = [];
  for (const g of rep.groups) {
    const byType = new Map();
    for (const r of g.rows) { if (r.cells.some((v) => v != null)) { if (!byType.has(r.p.type)) byType.set(r.p.type, []); byType.get(r.p.type).push(r); } }
    for (const [type, list] of byType) chartGroups.push({ name: g.name, type, list });
  }
  if (chartGroups.length && rep.days.length > 1) {
    newPage();
    heading('Drying curves', 'Reading over time; dashed line is the dry goal');
    for (const cg of chartGroups) {
      const H = 140;
      ensure(H + 50);
      doc.text(M, y + 10, `${cg.name} (${MOISTURE_TYPES[cg.type].short.trim()})`, { size: 10, bold: true, color: INK });
      y += 16;
      // legend
      let lx = M;
      cg.list.forEach((r, i) => {
        const c = PALETTE[i % PALETTE.length];
        doc.rect(lx, y, 8, 8, { fill: c });
        const t = `Pt ${r.p.n}: ${pointWhat(r.p)}`;
        const tt = clipText(t, 150, 7.5);
        if (lx + 12 + textWidth(tt, 7.5) > PW - M) { lx = M; y += 11; doc.rect(lx, y, 8, 8, { fill: c }); }
        doc.text(lx + 11, y + 7, tt, { size: 7.5, color: '#495057' });
        lx += 11 + textWidth(tt, 7.5) + 12;
      });
      y += 14;
      const goals = [...new Set(cg.list.map((r) => r.goal).filter((g) => g != null))];
      const maxV = Math.max(...cg.list.flatMap((r) => r.cells.filter((v) => v != null)), ...goals, 1);
      const sc = niceScale(maxV);
      const px = M + 34;
      const pw = CW - 34 - 40;
      const py = y;
      const X = (i) => px + (rep.days.length === 1 ? pw / 2 : (pw * i) / (rep.days.length - 1));
      const Y = (v) => py + H - (H * v) / sc.max;
      for (let v = 0; v <= sc.max + 1e-9; v += sc.step) {
        doc.line(px, Y(v), px + pw, Y(v), { color: '#e9ecef', width: 0.5 });
        doc.text(px - 5, Y(v) + 2.5, fmtReading(v), { size: 7, color: MUTED, align: 'right' });
      }
      doc.line(px, py + H, px + pw, py + H, { color: '#adb5bd', width: 0.75 });
      const every = Math.ceil(rep.days.length / 12);
      rep.days.forEach((d, i) => {
        if (i % every && i !== rep.days.length - 1) return;
        doc.text(X(i), py + H + 10, dateText(d.date), { size: 7, color: MUTED, align: 'center' });
      });
      for (const gv of goals) {
        doc.line(px, Y(gv), px + pw, Y(gv), { color: '#868e96', width: 1, dash: [4, 3] });
        doc.text(px + pw + 3, Y(gv) + 2.5, `goal ${fmtReading(gv)}`, { size: 7, color: '#495057' });
      }
      cg.list.forEach((r, i) => {
        const c = PALETTE[i % PALETTE.length];
        const pts = r.cells.map((v, k) => (v == null ? null : [X(k), Y(v)])).filter(Boolean);
        doc.polyline(pts, { color: c, width: 1.4 });
        pts.forEach(([cx, cy]) => doc.circle(cx, cy, 1.9, { fill: c }));
      });
      y += H + 24;
    }
  }

  // ---- dry standards -----------------------------------------------------------------------------------------------------
  if (rep.standards.length || rep.refs.length) {
    ensure(120);
    heading('Dry standards used');
    if (rep.standards.length) {
      const SRC = { measured: 'Measured at the dry standard points', entered: 'Standard for the material', point: 'Set for the point' };
      table(
        [{ w: 150, head: 'Material' }, { w: 80, head: 'Scale' }, { w: 80, head: 'Dry goal', align: 'center' }, { w: 110, head: 'Points' }, { w: CW - 420, head: 'Where it comes from' }],
        rep.standards.map((s) => [{ t: s.material, bold: true }, s.scale, `${fmtReading(s.goal)} or less`, s.points.map((n) => `Pt ${n}`).join(', '), SRC[s.source]]),
        { size: 8.5 },
      );
    }
    if (rep.refs.length) {
      doc.text(M, y + 8, 'Reference readings in unaffected areas', { size: 9, bold: true, color: '#495057' });
      y += 12;
      table(
        [{ w: 40, head: 'Pt' }, { w: 190, head: 'Room' }, { w: 150, head: 'Material' }, { w: CW - 380, head: 'Latest reading', align: 'right' }],
        rep.refs.map((r) => [{ t: String(r.n), bold: true }, r.room, r.material, r.val == null ? '-' : `${fmtReading(r.val)} ${r.scale}`]),
        { size: 8.5 },
      );
    }
  }

  // ---- air ---------------------------------------------------------------------------------------------------------------
  if (rep.air.length) {
    ensure(100);
    heading('Air readings', 'Humidity, temperature and grains per pound');
    table(
      [{ w: 90, head: 'Day' }, { w: 70, head: 'Date' }, { w: 40, head: 'Pt', align: 'center' }, { w: CW - 90 - 70 - 40 - 3 * 70, head: 'Room' }, { w: 70, head: 'RH %', align: 'center' }, { w: 70, head: 'Temp F', align: 'center' }, { w: 70, head: 'GPP', align: 'center' }],
      rep.air.map((a) => [a.day, a.date, String(a.n), a.room, a.rh == null ? '-' : fmtReading(a.rh), a.temp == null ? '-' : fmtReading(a.temp), a.gpp == null ? '-' : String(a.gpp)]),
      { size: 8.5 },
    );
  }

  // ---- the full log ------------------------------------------------------------------------------------------------------
  const log = moistureLogRows(plan);
  if (log.length) {
    newPage();
    heading('Reading log', `${log.length} reading${log.length === 1 ? '' : 's'}, oldest first`);
    // Day 0, Point 1, Room 3, Date 8, Time 9, Reading 10, Dry standard 11, Status 12, RH 13, Temp 14, GPP 15, By 16, Note 17
    const cols = [{ w: 56, head: 'Day' }, { w: 50, head: 'Date' }, { w: 44, head: 'Time' }, { w: 24, head: 'Pt', align: 'center' }, { w: 92, head: 'Room' }, { w: 46, head: 'Reading', align: 'center' }, { w: 36, head: 'Goal', align: 'center' }, { w: 32, head: 'RH', align: 'center' }, { w: 34, head: 'Temp', align: 'center' }, { w: 70, head: 'By' }, { w: CW - 56 - 50 - 44 - 24 - 92 - 46 - 36 - 32 - 34 - 70, head: 'Note' }];
    table(cols, log.map((c) => {
      const status = c[12];
      const air = c[2] === POINT_KINDS.air;
      return [c[0], c[8], c[9], String(c[1]), c[3], air ? '-' : { t: String(c[10]), bold: true, color: status === 'Dry' ? MOISTURE_COLORS.dry : status === 'Wet' ? MOISTURE_COLORS.wet : INK }, String(c[11] || ''), String(c[13]), String(c[14]), c[16], c[17]];
    }), { size: 7.5, lineH: 9.5, pad: 2.5 });
    doc.text(M, y + 2, 'The full log is also available as a spreadsheet (CSV) from the Moisture tab.', { size: 8, color: MUTED });
  }

  // footers
  const n = doc.count;
  for (let i = 0; i < n; i++) {
    doc.line(M, PH - 38, PW - M, PH - 38, { color: RULE, width: 0.5, page: i });
    doc.text(M, PH - 26, `Moisture Monitoring Report - ${title}`, { size: 7.5, color: MUTED, page: i });
    doc.text(PW - M, PH - 26, `Page ${i + 1} of ${n}`, { size: 7.5, color: MUTED, align: 'right', page: i });
  }
  return doc.finish();
}
