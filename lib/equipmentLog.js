// What the customer and the adjuster are shown about equipment: how much was set, where, and for how long.
// buildEquipment(plan) works the numbers out (pure, tested); equipmentLogCsv(plan) is the spreadsheet.
import { hitRoom } from './sketch.js';
import { roomLabel } from './roomLabel.js';
import { dateText, dayName } from './moistureDays.js';
import { csvCell } from './moistureLog.js';
import { ACTION_TEXT, EQUIPMENT_TYPES, daysOnSite, equipmentCounts, equipmentOnSite, orderedLog, typeRank, unitAt, unitCode } from './equipment.js';

// Everything the report and the log say about equipment, worked out from a plan.
//   units     one per machine: where it went, when it was placed and picked up, and the days it was on site
//   perDay    for each day: how many units were in place, by type
//   roomRows  one row per room and type, with a count for each day
//   peak      the day with the most units in place (the latest, when several tie)
export function buildEquipment(plan) {
  const days = plan.days || [];
  const idx = new Map(days.map((d, i) => [d.id, i]));
  const roomAt = (x, y) => hitRoom(plan, x, y);

  const units = (plan.equipment || []).map((u) => {
    const log = orderedLog(plan, u, idx);
    const first = log[0];
    const rooms = [];
    for (const { e } of log) {
      const name = roomLabel(roomAt(e.x, e.y));
      if (!rooms.length || rooms[rooms.length - 1] !== name) rooms.push(name);
    }
    const now = unitAt(plan, u, null);
    const out = now.state === 'out' ? now.entry : null;
    return {
      u, code: unitCode(u), type: EQUIPMENT_TYPES[u.t]?.label || 'Equipment', label: u.label, note: u.note,
      rooms, firstRoom: rooms[0] || '', lastRoom: rooms[rooms.length - 1] || '',
      moves: log.filter((x) => x.e.action === 'moved').length,
      placed: first ? { day: days[first.di], by: first.e.by?.name || '' } : null,
      pickedUp: out ? { day: days[idx.get(out.day)], by: out.by?.name || '' } : null,
      state: out ? 'out' : 'on',
      days: daysOnSite(plan, u),
    };
  }).sort((a, b) => (typeRank(a.u.t) - typeRank(b.u.t)) || (a.u.n - b.u.n));

  // each day: what was in place, and where
  const cellKey = (room, t) => `${room ? room.id : '_'}|${t}`;
  const rowMap = new Map();
  const perDay = days.map((d, di) => {
    const counts = equipmentCounts(plan, d.id);
    for (const r of equipmentOnSite(plan, d.id)) {
      const room = roomAt(r.x, r.y);
      const k = cellKey(room, r.u.t);
      if (!rowMap.has(k)) rowMap.set(k, { room, roomName: roomLabel(room), t: r.u.t, type: EQUIPMENT_TYPES[r.u.t]?.label || 'Equipment', code: EQUIPMENT_TYPES[r.u.t]?.code || 'EQ', cells: days.map(() => 0) });
      rowMap.get(k).cells[di] += 1;
    }
    return { day: d, total: counts.total, byType: counts.byType };
  });
  const roomRows = [...rowMap.values()].sort((a, b) => ((a.room ? a.room.num || 0 : 1e9) - (b.room ? b.room.num || 0 : 1e9)) || (typeRank(a.t) - typeRank(b.t)));

  let peak = null;
  for (const p of perDay) if (p.total > 0 && (!peak || p.total >= peak.total)) peak = p;

  const last = days.length ? days[days.length - 1] : null;
  return {
    has: units.length > 0,
    days, units, perDay, roomRows, peak,
    placedCount: units.length,
    onSiteNow: last ? equipmentCounts(plan, last.id) : { total: 0, byType: {} },
    pickedUpCount: units.filter((x) => x.state === 'out').length,
    unitDays: units.reduce((s, x) => s + x.days, 0),
    lastDay: last,
  };
}


export const EQUIPMENT_COLUMNS = ['Unit', 'Equipment', 'Model / unit no.', 'Placed in', 'Now or last in', 'Times moved', 'Day placed', 'Date placed', 'Placed by', 'Day picked up', 'Date picked up', 'Picked up by', 'Days on site', 'Status', 'Note'];

// One row per machine, as cells.
export function equipmentLogRows(plan) {
  const eq = buildEquipment(plan);
  const days = plan.days || [];
  return eq.units.map((x) => [
    x.code, x.type, x.label, x.firstRoom, x.lastRoom, x.moves,
    x.placed ? dayName(days, x.placed.day.id) : '', x.placed ? x.placed.day.date : '', x.placed ? x.placed.by : '',
    x.pickedUp ? dayName(days, x.pickedUp.day.id) : '', x.pickedUp ? x.pickedUp.day.date : '', x.pickedUp ? x.pickedUp.by : '',
    x.days, x.state === 'out' ? 'Picked up' : 'On site', x.note,
  ]);
}

export function equipmentLogCsv(plan) {
  const lines = [EQUIPMENT_COLUMNS, ...equipmentLogRows(plan)].map((row) => row.map(csvCell).join(','));
  return `\ufeff${lines.join('\r\n')}\r\n`; // the byte-order mark makes Excel read it as UTF-8
}

// What one unit went through, newest last: [{ text: 'Placed', day, date, room, by }]
export function unitHistory(plan, u) {
  const days = plan.days || [];
  return orderedLog(plan, u).map(({ e }) => ({
    id: e.id, action: e.action, text: ACTION_TEXT[e.action], day: dayName(days, e.day), date: dateText(days.find((d) => d.id === e.day)?.date),
    room: roomLabel(hitRoom(plan, e.x, e.y)), by: e.by?.name || '',
  }));
}
