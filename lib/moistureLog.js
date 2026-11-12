// The moisture log: every reading at every point, oldest first, as a CSV a customer or adjuster can open in a spreadsheet.
import { hitRoom, roomTitle } from './sketch.js';
import { dailyMatrix, dateText, dayName } from './moistureDays.js';
import { MOISTURE_MATERIALS, MOISTURE_SURFACES, MOISTURE_TYPES, POINT_KINDS, fmtReading, goalFor, gpp, sortedReadings } from './moisture.js';

export const LOG_COLUMNS = ['Day', 'Point', 'Point type', 'Room', 'Surface', 'Height up wall (ft)', 'Material', 'Reading type', 'Date', 'Time', 'Reading', 'Dry standard', 'Status', 'Humidity (% RH)', 'Temperature (F)', 'GPP', 'Taken by', 'Note'];

// Quotes a cell, and keeps a spreadsheet from running one that starts like a formula.
export function csvCell(v) {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

// Rows for the log, one per reading, ordered by time then point number.
export function moistureLogRows(plan) {
  const rows = [];
  for (const p of plan.moisture || []) {
    const room = hitRoom(plan, p.x, p.y);
    const goal = goalFor(plan, p);
    const air = p.kind === 'air';
    for (const r of sortedReadings(p)) {
      const d = new Date(r.at);
      const g = gpp(r.temp, r.rh);
      rows.push({
        at: Date.parse(r.at), n: p.n,
        cells: [
          dayName(plan.days || [], r.day), p.n, POINT_KINDS[p.kind] || POINT_KINDS.reading, room ? roomTitle(room) : '',
          air ? '' : MOISTURE_SURFACES[p.surface], !air && p.surface === 'wall' && p.h != null ? p.h : '', air ? '' : MOISTURE_MATERIALS[p.material], air ? '' : MOISTURE_TYPES[p.type].label,
          d.toLocaleDateString('en-US'), d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          r.val == null ? '' : fmtReading(r.val), goal == null || r.val == null ? '' : fmtReading(goal), goal == null || r.val == null ? '' : r.val <= goal ? 'Dry' : 'Wet',
          r.rh == null ? '' : fmtReading(r.rh), r.temp == null ? '' : fmtReading(r.temp), g == null ? '' : Math.round(g),
          r.by?.name || '', r.note || '',
        ],
      });
    }
  }
  return rows.sort((a, b) => (a.at - b.at) || (a.n - b.n)).map((x) => x.cells);
}

export function moistureLogCsv(plan) {
  const lines = [LOG_COLUMNS, ...moistureLogRows(plan)].map((row) => row.map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`; // the byte-order mark makes Excel read it as UTF-8
}

// The drying summary: one row per point, one column per day, so a loss reads at a glance from first reading to dry.
export function moistureSummaryCsv(plan) {
  const days = plan.days || [];
  const head = ['Point', 'Point type', 'Room', 'Surface', 'Material', 'Reading type', 'Dry standard', ...days.map((d) => `${dayName(days, d.id)} (${dateText(d.date)})`), 'Status'];
  const rows = dailyMatrix(plan).map(({ p, goal, cells }) => {
    const room = hitRoom(plan, p.x, p.y);
    const last = [...cells].reverse().find((v) => v != null);
    return [
      p.n, POINT_KINDS[p.kind] || POINT_KINDS.reading, room ? roomTitle(room) : '', MOISTURE_SURFACES[p.surface], MOISTURE_MATERIALS[p.material], MOISTURE_TYPES[p.type].label, goal == null ? '' : fmtReading(goal),
      ...cells.map((v) => (v == null ? '' : fmtReading(v))),
      last == null ? 'No readings' : goal == null ? '' : last <= goal ? 'Dry' : 'Wet',
    ];
  });
  return `\ufeff${[head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
