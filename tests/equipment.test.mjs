import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlan, normalizePlan, newRoom, ensureRoomNums } from '../lib/sketch.js';
import { removeDay } from '../lib/moistureDays.js';
import {
  EQUIPMENT_TYPES, EQUIPMENT_ORDER, MAX_ACTIONS, countText, daysOnSite, cleanEquipment, equipmentActionsOnDay, equipmentCounts, equipmentOnPlan, equipmentOnSite,
  hitEquipment, makeEquipment, moveUnit, nextEquipNumber, pickUpUnit, putBackUnit, unitAt, unitCode,
} from '../lib/equipment.js';
import { buildEquipment, equipmentLogCsv, equipmentLogRows, unitHistory } from '../lib/equipmentLog.js';
import { drawPlan } from '../lib/sketchDraw.js';
import { renderMoistureReport } from '../lib/moistureReport.js';

const by = { id: 'u1', name: 'Sam Tech' };
const at = (d, h = 15) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;

// Kitchen (0..12 x 0..10) and Bedroom (14..24 x 0..10); three days: Nov 10, 11, 12
function plan0() {
  const p = ensureRoomNums({ ...emptyPlan(), rooms: [newRoom('Kitchen', 0, 0, 12, 10), newRoom('Bedroom', 14, 0, 10, 10)] });
  return { ...p, days: [{ id: 'd1', date: '2026-11-10' }, { id: 'd2', date: '2026-11-11' }, { id: 'd3', date: '2026-11-12' }, { id: 'd4', date: '2026-11-13' }] };
}
const place = (plan, t, x, y, day, extra = {}) => {
  const u = makeEquipment(t, nextEquipNumber(plan.equipment, t), x, y, { day, at: at(10 + Number(day.slice(1)) - 1), by, ...extra });
  return { ...plan, equipment: [...plan.equipment, u] };
};

test('every equipment type has a label, plural, two-letter code, group and colour, and the codes are unique', () => {
  const codes = new Set();
  for (const k of EQUIPMENT_ORDER) {
    const t = EQUIPMENT_TYPES[k];
    assert.ok(t.label && t.plural && t.group && /^#[0-9a-f]{6}$/i.test(t.color), k);
    assert.equal(t.code.length, 2, k);
    assert.ok(!codes.has(t.code), `duplicate code ${t.code}`);
    codes.add(t.code);
  }
  for (const k of ['airmover', 'dehu', 'scrubber']) assert.ok(EQUIPMENT_TYPES[k], k);
});

test('a placed unit stands where it was put from its first day, and not before', () => {
  let p = plan0();
  p = place(p, 'airmover', 5, 5, 'd2');
  const u = p.equipment[0];
  assert.equal(unitAt(p, u, 'd1').state, 'none');
  assert.deepEqual([unitAt(p, u, 'd2').state, unitAt(p, u, 'd2').x, unitAt(p, u, 'd2').y], ['on', 5, 5]);
  assert.equal(unitAt(p, u, 'd4').state, 'on', 'stays in place on later days');
  assert.equal(unitAt(p, u, null).state, 'on', 'no day: as it stands now');
  assert.equal(unitAt(p, u, 'nope').state, 'on', 'an unknown day reads as now, like the moisture views');
  assert.equal(unitCode(u), 'AM 1');
});

test('numbers count up within a type and are never shared', () => {
  let p = plan0();
  p = place(p, 'airmover', 1, 1, 'd1');
  p = place(p, 'airmover', 2, 2, 'd1');
  p = place(p, 'dehu', 3, 3, 'd1');
  assert.deepEqual(p.equipment.map(unitCode), ['AM 1', 'AM 2', 'DH 1']);
  assert.equal(nextEquipNumber(p.equipment, 'airmover'), 3);
  assert.equal(nextEquipNumber(p.equipment, 'scrubber'), 1);
});

test('moving a unit on a later day adds a step; moving it again the same day only corrects the spot', () => {
  let p = plan0();
  p = place(p, 'airmover', 5, 5, 'd1');
  let u = p.equipment[0];
  u = moveUnit(p, u, { x: 16, y: 4, day: 'd3', at: at(12), by });
  assert.equal(u.log.length, 2);
  assert.equal(u.log[1].action, 'moved');
  let q = { ...p, equipment: [u] };
  assert.deepEqual([unitAt(q, u, 'd2').x, unitAt(q, u, 'd3').x], [5, 16], 'the old spot until the day it moved');
  const again = moveUnit(q, u, { x: 18, y: 4, day: 'd3', at: at(12, 17), by });
  assert.equal(again.log.length, 2, 'same day: a correction, not another step');
  assert.equal(unitAt({ ...p, equipment: [again] }, again, 'd3').x, 18);
  // fixing the placement on the day it was placed stays one entry too
  const fixed = moveUnit(p, p.equipment[0], { x: 6, y: 6, day: 'd1', by });
  assert.equal(fixed.log.length, 1);
  assert.equal(fixed.log[0].x, 6);
});

test('picking up and putting back: out from that day, kept where it stood, and put back the same day is as if never picked up', () => {
  let p = plan0();
  p = place(p, 'dehu', 5, 5, 'd1');
  let u = p.equipment[0];
  u = pickUpUnit(p, u, { day: 'd3', at: at(12), by });
  p = { ...p, equipment: [u] };
  assert.equal(unitAt(p, u, 'd2').state, 'on');
  const out = unitAt(p, u, 'd3');
  assert.deepEqual([out.state, out.x, out.y], ['out', 5, 5]);
  assert.equal(unitAt(p, u, 'd4').state, 'out');
  assert.equal(pickUpUnit(p, u, { day: 'd4', by }), u, 'already out: nothing to do');
  assert.equal(moveUnit(p, u, { x: 1, y: 1, day: 'd4', by }), u, 'a picked-up unit cannot be moved');
  // put back on a later day: a new stretch
  const back = putBackUnit(p, u, { day: 'd4', at: at(13), by });
  assert.equal(unitAt({ ...p, equipment: [back] }, back, 'd4').state, 'on');
  assert.equal(back.log.length, 3);
  // put back the same day it was picked up: the pick-up just goes away
  const undone = putBackUnit(p, u, { day: 'd3', by });
  assert.equal(undone.log.length, 1);
  assert.equal(unitAt({ ...p, equipment: [undone] }, undone, 'd4').state, 'on');
  assert.equal(putBackUnit(p, p.equipment[0].log.length ? { ...u, log: [u.log[0]] } : u, { day: 'd2', by }).log.length, 1, 'only a unit that is out can be put back');
});

test('the plan shows units in place, and units picked up that very day as a faded ghost', () => {
  let p = plan0();
  p = place(p, 'airmover', 2, 2, 'd1');
  p = place(p, 'airmover', 4, 2, 'd1');
  p = { ...p, equipment: [p.equipment[0], pickUpUnit(p, p.equipment[1], { day: 'd3', by })] };
  assert.deepEqual(equipmentOnPlan(p, 'd2').map((r) => [r.u.n, r.state]), [[1, 'on'], [2, 'on']]);
  assert.deepEqual(equipmentOnPlan(p, 'd3').map((r) => [r.u.n, r.state]), [[1, 'on'], [2, 'out']], 'the day it is picked up it shows faded');
  assert.deepEqual(equipmentOnPlan(p, 'd4').map((r) => [r.u.n, r.state]), [[1, 'on']], 'gone the day after');
  assert.equal(equipmentOnSite(p, 'd3').length, 1);
  assert.equal(equipmentCounts(p, 'd3').total, 1);
});

test('counts by type, and the sentence for them', () => {
  let p = plan0();
  for (let i = 0; i < 4; i++) p = place(p, 'airmover', 1 + i, 1, 'd1');
  p = place(p, 'dehu', 3, 3, 'd1');
  p = place(p, 'dehu', 4, 3, 'd1');
  p = place(p, 'scrubber', 5, 3, 'd2');
  const c1 = equipmentCounts(p, 'd1');
  assert.deepEqual(c1, { total: 6, byType: { airmover: 4, dehu: 2 } });
  assert.equal(countText(c1), '4 air movers · 2 LGR dehumidifiers');
  assert.equal(countText(equipmentCounts(p, 'd2')), '4 air movers · 2 LGR dehumidifiers · 1 air scrubber');
  assert.equal(countText({ total: 1, byType: { heater: 1 } }), '1 heater');
  assert.equal(countText({ total: 0, byType: {} }), '');
  assert.equal(countText({ total: 1, byType: { other: 1 } }), '1 other equipment');
});

test('days on site run in 24-hour days from the date placed: picked up Nov 13 after Nov 10 is 3, and a unit still there counts through the latest day', () => {
  let p = plan0();
  p = place(p, 'airmover', 5, 5, 'd1');
  const u = p.equipment[0];
  assert.equal(daysOnSite(p, u, 'd1'), 1);
  assert.equal(daysOnSite(p, u, 'd3'), 3);
  assert.equal(daysOnSite(p, u), 4, 'through the latest day by default');
  const gone = pickUpUnit(p, u, { day: 'd4', by });
  const q = { ...p, equipment: [gone] };
  assert.equal(daysOnSite(q, gone), 3);
  assert.equal(daysOnSite(q, gone, 'd2'), 2, 'asked about an earlier day, the pick-up has not happened yet');
  // placed and picked up on the same day counts as one day
  const same = pickUpUnit(p, u, { day: 'd1', by });
  assert.equal(daysOnSite({ ...p, equipment: [same] }, same), 1);
  // picked up Nov 11 and put back Nov 13, then still there: 1 + 1 (Nov 13 only)
  let w = pickUpUnit(p, u, { day: 'd2', by });
  w = putBackUnit({ ...p, equipment: [w] }, w, { day: 'd4', by });
  assert.equal(daysOnSite({ ...p, equipment: [w] }, w), 2);
  assert.equal(daysOnSite({ ...emptyPlan() }, u), 0, 'no days: nothing to count');
});

test('a gap between days still counts the calendar days', () => {
  const p0 = { ...plan0(), days: [{ id: 'a', date: '2026-11-10' }, { id: 'b', date: '2026-11-14' }] };
  const p = place(p0, 'dehu', 5, 5, 'a');
  assert.equal(daysOnSite(p, p.equipment[0]), 5);
});

test('hitEquipment finds the nearest unit in place that day and ignores units not yet placed or long gone', () => {
  let p = plan0();
  p = place(p, 'airmover', 2, 2, 'd2');
  p = place(p, 'dehu', 2.5, 2, 'd1');
  assert.equal(hitEquipment(p, 'd1', 2.2, 2, 1)?.u.t, 'dehu', 'the airmover is not there yet');
  assert.equal(hitEquipment(p, 'd2', 2.1, 2, 1)?.u.t, 'airmover', 'nearest of the two');
  assert.equal(hitEquipment(p, 'd2', 9, 9, 1), null);
});

test('cleanEquipment repairs stored data: types, numbers, entries on missing days, silly numbers', () => {
  let i = 0;
  const uid = (id) => (typeof id === 'string' && id ? id : `gen${i++}`);
  const days = new Set(['d1', 'd2']);
  const e = (action, day, x = 1, y = 1, extra = {}) => ({ id: `e${i++}`, action, day, at: at(10), by, x, y, ...extra });
  const out = cleanEquipment([
    { id: 'a', t: 'airmover', n: 2, label: 'x'.repeat(100), note: 'n'.repeat(200), log: [e('placed', 'd1', 99999, -99999), e('moved', 'gone'), e('teleported', 'd1'), e('removed', 'd2', 'x', 1), e('moved', 'd2', 3, 4, { at: 'not a date' })] },
    { id: 'b', t: 'airmover', n: 2, log: [e('placed', 'd1')] },
    { id: 'c', t: 'flux capacitor', n: 'seven', log: [e('placed', 'd2')] },
    { id: 'd', t: 'dehu', n: 1, log: [e('placed', 'gone')] },
    { id: 'e', t: 'dehu', n: 1 },
    null,
    'junk',
  ], uid, days);
  assert.equal(out.length, 3, 'a unit with no usable entry is dropped');
  const [a, b, c] = out;
  assert.equal(a.label.length, 40);
  assert.equal(a.note.length, 80);
  assert.deepEqual(a.log.map((x) => x.action), ['placed', 'moved'], 'bad actions, missing days and bad spots are dropped');
  assert.equal(a.log[0].x, 5000, 'coordinates are limited');
  assert.ok(Number.isFinite(Date.parse(a.log[1].at)));
  assert.deepEqual([a.n, b.n], [2, 3], 'two of one type never share a number');
  assert.equal(c.t, 'other', 'an unknown type becomes other equipment');
  assert.ok(c.n >= 1);
  assert.deepEqual(cleanEquipment(undefined, uid, days), []);
  assert.deepEqual(cleanEquipment({}, uid, days), []);
  const many = cleanEquipment([{ t: 'heater', n: 1, log: Array.from({ length: MAX_ACTIONS + 20 }, () => e('moved', 'd1')) }], uid, days);
  assert.equal(many[0].log.length, MAX_ACTIONS);
});

test('a sketch round-trips its equipment, and a sketch from before equipment has an empty list', () => {
  let p = plan0();
  p = place(p, 'airmover', 5, 5, 'd1');
  p = place(p, 'scrubber', 17, 5, 'd2');
  const back = normalizePlan(JSON.parse(JSON.stringify(p)));
  assert.equal(back.equipment.length, 2);
  assert.deepEqual(back.equipment.map((u) => [u.t, u.n]), [['airmover', 1], ['scrubber', 1]]);
  assert.deepEqual(back.equipment[0].log[0], { ...p.equipment[0].log[0] });
  assert.deepEqual(normalizePlan({ rooms: [] }).equipment, []);
  assert.deepEqual(normalizePlan(null).equipment, []);
  assert.deepEqual(emptyPlan().equipment, []);
});

test('deleting a day takes what was done on it, and a unit with nothing left goes too', () => {
  let p = plan0();
  p = place(p, 'airmover', 5, 5, 'd1');
  p = place(p, 'dehu', 6, 5, 'd2');
  p = { ...p, equipment: [pickUpUnit(p, p.equipment[0], { day: 'd3', by }), p.equipment[1]] };
  assert.equal(equipmentActionsOnDay(p, 'd3'), 1);
  assert.equal(equipmentActionsOnDay(p, 'd2'), 1);
  const noD3 = removeDay(p, 'd3');
  assert.equal(noD3.equipment.length, 2);
  assert.equal(unitAt(noD3, noD3.equipment[0], 'd4').state, 'on', 'the pick-up was on the deleted day, so the unit is back in place');
  const noD2 = removeDay(p, 'd2');
  assert.deepEqual(noD2.equipment.map((u) => u.t), ['airmover'], 'the dehumidifier only existed on that day');
});

test('buildEquipment: units, rooms, per-day counts, the busiest day and days on site', () => {
  let p = plan0();
  p = place(p, 'airmover', 3, 3, 'd1');   // kitchen
  p = place(p, 'airmover', 8, 3, 'd1');   // kitchen
  p = place(p, 'dehu', 16, 3, 'd1');      // bedroom
  p = place(p, 'scrubber', 5, 5, 'd2');   // kitchen
  p = { ...p, equipment: [
    p.equipment[0],
    moveUnit(p, p.equipment[1], { x: 16, y: 6, day: 'd3', by }),
    pickUpUnit(p, p.equipment[2], { day: 'd4', by }),
    p.equipment[3],
  ] };
  const eq = buildEquipment(p);
  assert.equal(eq.has, true);
  assert.equal(eq.placedCount, 4);
  assert.deepEqual(eq.perDay.map((d) => d.total), [3, 4, 4, 3]);
  assert.equal(eq.peak.day.id, 'd3', 'ties go to the latest day');
  assert.equal(eq.peak.total, 4);
  assert.equal(eq.onSiteNow.total, 3);
  assert.equal(eq.pickedUpCount, 1);
  const am2 = eq.units.find((x) => x.code === 'AM 2');
  assert.deepEqual(am2.rooms, ['#1 Kitchen', '#2 Bedroom']);
  assert.equal(am2.moves, 1);
  assert.equal(am2.firstRoom, '#1 Kitchen');
  assert.equal(am2.lastRoom, '#2 Bedroom');
  const dh = eq.units.find((x) => x.code === 'DH 1');
  assert.equal(dh.state, 'out');
  assert.equal(dh.days, 3);
  assert.equal(dh.pickedUp.day.id, 'd4');
  assert.equal(dh.placed.by, 'Sam Tech');
  assert.equal(eq.unitDays, 4 + 4 + 3 + 3, 'AM 1: 4, AM 2: 4, DH 1: 3, AS 1: Nov 11-13 = 3');
  // rows for the room table: Kitchen first, then Bedroom, types in a fixed order
  assert.deepEqual(eq.roomRows.map((r) => [r.roomName, r.t, r.cells]), [
    ['#1 Kitchen', 'airmover', [2, 2, 1, 1]],
    ['#1 Kitchen', 'scrubber', [0, 1, 1, 1]],
    ['#2 Bedroom', 'airmover', [0, 0, 1, 1]],
    ['#2 Bedroom', 'dehu', [1, 1, 1, 0]],
  ]);
  // nothing placed
  const none = buildEquipment(plan0());
  assert.equal(none.has, false);
  assert.equal(none.peak, null);
});

test('the equipment log (CSV) has a row per machine and is safe for a spreadsheet', () => {
  let p = plan0();
  p = place(p, 'airmover', 3, 3, 'd1', { label: '=HYPERLINK("x")', note: 'by the "sink", wet' });
  p = place(p, 'dehu', 16, 3, 'd1');
  p = { ...p, equipment: [p.equipment[0], pickUpUnit(p, p.equipment[1], { day: 'd3', by })] };
  const rows = equipmentLogRows(p);
  assert.equal(rows.length, 2);
  const csv = equipmentLogCsv(p);
  assert.ok(csv.startsWith('﻿Unit,Equipment,Model / unit no.'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].includes("'=HYPERLINK"), 'a formula is defused');
  assert.ok(lines[1].includes('"by the ""sink"", wet"'));
  assert.ok(lines[2].includes('DH 1,LGR dehumidifier'));
  assert.ok(lines[2].includes('Picked up'));
  assert.ok(lines[2].includes(',2026-11-12,'), 'date picked up');
  assert.ok(lines[1].includes(',On site,'));
});

test('unitHistory lists what happened to a unit, oldest first, with the room each time', () => {
  let p = plan0();
  p = place(p, 'airmover', 3, 3, 'd1');
  let u = moveUnit(p, p.equipment[0], { x: 16, y: 3, day: 'd2', at: at(11), by });
  u = pickUpUnit({ ...p, equipment: [u] }, u, { day: 'd3', at: at(12), by });
  const h = unitHistory({ ...p, equipment: [u] }, u);
  assert.deepEqual(h.map((x) => [x.text, x.day, x.room]), [['Placed', 'Initial loss', '#1 Kitchen'], ['Moved', 'Day 2', '#2 Bedroom'], ['Picked up', 'Day 3', '#2 Bedroom']]);
  assert.equal(h[0].by, 'Sam Tech');
});

test('drawPlan draws equipment (in place and ghost), faint or full, and only the zoomed room, without breaking', () => {
  let p = plan0();
  p = place(p, 'airmover', 3, 3, 'd1');
  p = place(p, 'dehu', 16, 3, 'd1');
  p = { ...p, equipment: [p.equipment[0], pickUpUnit(p, p.equipment[1], { day: 'd2', by })] };
  const view = { scale: 20, ox: 10, oy: 10 };
  const texts = [];
  const mk = () => new Proxy({}, { get: (t, k) => (k === 'measureText' ? (s) => ({ width: String(s).length * 7 }) : k === 'fillText' ? (s) => { texts.push(s); } : (typeof k === 'string' && !(k in t) ? () => {} : t[k])), set: (t, k, v) => { t[k] = v; return true; } });
  drawPlan(mk(), p, view, { W: 600, H: 300, plain: true, grid: false, equipment: true, equipDay: 'd2' });
  assert.ok(texts.includes('AM 1') && texts.includes('DH 1'), 'the ghost shows on the day it is picked up');
  texts.length = 0;
  drawPlan(mk(), p, view, { W: 600, H: 300, plain: true, grid: false, equipment: true, equipDay: 'd3' });
  assert.deepEqual(texts.filter((t) => /^[A-Z]{2} \d$/.test(t)), ['AM 1'], 'gone the day after');
  texts.length = 0;
  drawPlan(mk(), p, view, { W: 600, H: 300, plain: true, grid: false, equipment: true, equipDay: 'd1', focusRoom: p.rooms[1].id });
  assert.deepEqual(texts.filter((t) => /^[A-Z]{2} \d$/.test(t)), ['DH 1'], 'zoomed into the bedroom, only its equipment');
  texts.length = 0;
  drawPlan(mk(), p, view, { W: 600, H: 300, plain: true, grid: false, equipment: false, equipDay: 'd1' });
  assert.equal(texts.filter((t) => /^[A-Z]{2} \d$/.test(t)).length, 0, 'layer off');
  drawPlan(mk(), p, view, { W: 600, H: 300, plain: true, grid: false, equipment: true, equipFaint: true, equipDay: 'd1', selection: { kind: 'equipment', id: p.equipment[0].id } });
  drawPlan(mk(), p, view, { W: 600, H: 300, plain: true, grid: false, equipment: true, moistFaint: true, equipDay: 'd1' });
});

test('the customer report includes the equipment sections and still renders without any equipment', () => {
  let p = plan0();
  p = place(p, 'airmover', 3, 3, 'd1', { label: 'Dri-Eaz F203' });
  p = place(p, 'dehu', 16, 3, 'd1');
  const withEq = renderMoistureReport(p, { title: 'Test job', planImage: null, equipImage: null, preparedAt: new Date('2026-11-13T12:00:00Z') });
  const without = renderMoistureReport(plan0(), { title: 'Test job', planImage: null, preparedAt: new Date('2026-11-13T12:00:00Z') });
  const text = (b) => Buffer.from(b).toString('latin1');
  assert.ok(text(withEq).includes('Equipment placed'));
  assert.ok(text(withEq).includes('Equipment log'));
  assert.ok(!text(without).includes('Equipment placed'));
  assert.ok(text(withEq).includes('Dri-Eaz F203'));
});
