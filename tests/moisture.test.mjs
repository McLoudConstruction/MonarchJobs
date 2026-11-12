import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlan, normalizePlan, newRoom, heightFor, planBounds, cleanSurfaces } from '../lib/sketch.js';
import {
  gpp, parseReading, fmtReading, makeMoisture, makeReading, cleanMoisture, cleanStandards, nextNumber, moistureStatus, goalFor,
  moistureCounts, hitMoisture, valueText, airText, sortedReadings, MAX_READINGS, padEdit,
} from '../lib/moisture.js';
import { moistureLogCsv, moistureLogRows, csvCell } from '../lib/moistureLog.js';
import { drawPlan } from '../lib/sketchDraw.js';

const by = { id: 'u1', name: 'Sam Tech' };
const at = (d) => `2026-11-${String(d).padStart(2, '0')}T15:00:00.000Z`;
const reading = (val, day, extra = {}) => makeReading({ val, at: at(day), by, ...extra });
const point = (n, x, y, opts = {}, readings = []) => ({ ...makeMoisture(n, x, y, opts), readings });
const base = () => ({ ...emptyPlan(), rooms: [newRoom('Kitchen', 0, 0, 12, 10)] });

test('full wall: floor + wall + ceiling together set the wall height to Full, anything else keeps it', () => {
  assert.equal(heightFor(['floor', 'wall', 'ceiling'], 2), 8);
  assert.equal(heightFor(cleanSurfaces(['ceiling', 'floor', 'wall']), 4), 8);
  assert.equal(heightFor(['floor', 'wall'], 4), 4);
  assert.equal(heightFor(['wall', 'ceiling'], 2), 2);
  assert.equal(heightFor(undefined, 2), 2);
});

test('gpp matches the psychrometric chart and refuses missing or silly input', () => {
  assert.ok(Math.abs(gpp(70, 50) - 54) < 1.2, String(gpp(70, 50)));
  assert.ok(Math.abs(gpp(80, 60) - 92) < 1.5, String(gpp(80, 60)));
  assert.equal(gpp(70, null), null);
  assert.equal(gpp('', 50), null);
  assert.equal(gpp(70, 120), null);
  assert.equal(gpp('abc', 50), null);
});

test('parseReading takes plain numbers only', () => {
  assert.equal(parseReading('12.4'), 12.4);
  assert.equal(parseReading(' 7 '), 7);
  assert.equal(parseReading('.5'), 0.5);
  for (const bad of ['', 'x', '-3', '1,5', '12%', null]) assert.ok(Number.isNaN(parseReading(bad)), String(bad));
  assert.equal(fmtReading(12.04), '12');
  assert.equal(fmtReading(12.46), '12.5');
});

test('cleanMoisture repairs stored data: limits, unknown values, duplicate pin numbers, bad readings', () => {
  let i = 0;
  const uid = (id) => (typeof id === 'string' && id ? id : `gen${i++}`);
  const out = cleanMoisture([
    { id: 'a', n: 3, x: 1, y: 2, surface: 'wall', material: 'drywall', type: 'wme', goal: 150, h: 2.555, readings: [
      { id: 'r1', at: at(2), val: 14.26, rh: 48, temp: 72, by: { id: 7, name: 'N'.repeat(100) }, note: 'x'.repeat(200) },
      { id: 'r2', at: 'not a date', val: 'abc' },
      { id: 'r3', at: at(3), val: 500, rh: 'x', temp: 999 },
    ] },
    { id: 'b', n: 3, x: 5, y: 5, surface: 'roof', material: 'moon rock', type: 'zzz' },
    { id: 'c', x: 'bad', y: 1 },
    { id: 'd', n: 'seven', x: 0, y: 0 },
    null,
  ], uid);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((p) => p.n), [3, 4, 5], 'unique, repaired numbers');
  const a = out[0];
  assert.equal(a.type, 'wme');
  assert.equal(a.goal, 100);
  assert.equal(a.h, 2.56);
  assert.equal(a.readings.length, 2, 'the reading with no number is dropped');
  assert.equal(a.readings[0].val, 14.3);
  assert.equal(a.readings[0].by.name.length, 60);
  assert.equal(a.readings[0].note.length, 80);
  assert.equal(a.readings[1].val, 100);
  assert.equal(a.readings[1].rh, null);
  assert.equal(a.readings[1].temp, 200);
  assert.deepEqual([out[1].surface, out[1].material, out[1].type], ['floor', 'other', 'mc']);
  assert.equal(cleanMoisture('nope', uid).length, 0);
  const many = cleanMoisture([{ x: 0, y: 0, readings: Array.from({ length: 200 }, (_, k) => ({ at: at(1), val: k % 50 })) }], uid);
  assert.equal(many[0].readings.length, MAX_READINGS);
});

test('pin numbers carry on from the highest in use', () => {
  assert.equal(nextNumber([]), 1);
  assert.equal(nextNumber([{ n: 1 }, { n: 5 }, { n: 2 }]), 6);
});

test('status: no reading, no goal, dry, wet, and the trend since the last reading', () => {
  const none = point(1, 0, 0, { goal: 12 });
  assert.equal(moistureStatus(none).state, 'none');
  const unset = point(2, 0, 0, {}, [reading(20, 2)]);
  assert.equal(moistureStatus(unset).state, 'unset');
  const p = point(3, 0, 0, { goal: 12 }, [reading(30, 2), reading(22, 3)]);
  let st = moistureStatus(p, p.goal);
  assert.deepEqual([st.state, st.trend, st.latest.val], ['wet', 'down', 22]);
  p.readings.push(reading(11.9, 4));
  st = moistureStatus(p, p.goal);
  assert.deepEqual([st.state, st.trend], ['dry', 'down']);
  p.readings.push(reading(12, 5));
  assert.equal(moistureStatus(p, p.goal).trend, 'up');
  p.readings.push(reading(12, 6));
  assert.equal(moistureStatus(p, p.goal).trend, 'flat');
  assert.equal(moistureStatus(p, p.goal).state, 'dry', 'at the standard counts as dry');
});

test('readings are ordered by time, not by the order they were entered', () => {
  const p = point(1, 0, 0, { goal: 10 }, [reading(9, 5), reading(30, 2), reading(15, 3)]);
  assert.deepEqual(sortedReadings(p).map((r) => r.val), [30, 15, 9]);
  assert.equal(moistureStatus(p, 10).latest.val, 9);
});

test('the job dry standard applies to a material unless the point has its own goal or reads on another scale', () => {
  const plan = { ...base(), standards: cleanStandards({ drywall: { val: 12, type: 'mc' }, hardwood: { val: 9, type: 'wme' }, bogus: { val: 1 }, tile: { val: 'x' } }) };
  assert.deepEqual(Object.keys(plan.standards).sort(), ['drywall', 'hardwood']);
  assert.equal(goalFor(plan, point(1, 0, 0, { material: 'drywall', type: 'mc' })), 12);
  assert.equal(goalFor(plan, point(1, 0, 0, { material: 'drywall', type: 'mc', goal: 15 })), 15);
  assert.equal(goalFor(plan, point(1, 0, 0, { material: 'drywall', type: 'rel' })), null, 'different scale');
  assert.equal(goalFor(plan, point(1, 0, 0, { material: 'carpet' })), null);
  const withReadings = { ...plan, moisture: [
    point(1, 1, 1, { material: 'drywall' }, [reading(20, 2)]),
    point(2, 2, 2, { material: 'drywall' }, [reading(10, 2)]),
    point(3, 3, 3, { material: 'carpet' }, [reading(10, 2)]),
    point(4, 4, 4, {}, []),
  ] };
  assert.deepEqual(moistureCounts(withReadings), { points: 4, wet: 1, dry: 1, unset: 1, none: 1 });
});

test('normalizePlan keeps moisture and standards, and old sketches get empty ones', () => {
  assert.deepEqual(emptyPlan().moisture, []);
  assert.deepEqual(emptyPlan().standards, {});
  const old = normalizePlan({ rooms: [{ id: 'r', x: 0, y: 0, w: 10, h: 10 }] });
  assert.deepEqual([old.moisture, old.standards], [[], {}]);
  const src = { ...base(), moisture: [point(1, 2, 3, { surface: 'wall', h: 2 }, [reading(18.5, 2, { rh: 50, temp: 70 })])], standards: { drywall: { val: 12, type: 'mc' } } };
  const back = normalizePlan(JSON.parse(JSON.stringify(src)));
  assert.equal(back.moisture.length, 1);
  assert.equal(back.moisture[0].readings[0].val, 18.5);
  assert.equal(back.moisture[0].h, 2);
  assert.deepEqual(back.standards, src.standards);
});

test('hitting a point honours the distance and the surface being shown', () => {
  const plan = { ...base(), moisture: [point(1, 5, 5, { surface: 'floor' }), point(2, 5.2, 5, { surface: 'wall' })] };
  assert.equal(hitMoisture(plan, 5.05, 5, 0.5).n, 1, 'nearest wins');
  assert.equal(hitMoisture(plan, 5.15, 5, 0.5, 'wall').n, 2);
  assert.equal(hitMoisture(plan, 5.15, 5, 0.5, 'ceiling'), null);
  assert.equal(hitMoisture(plan, 9, 9, 0.5), null);
  assert.equal(hitMoisture({ rooms: [] }, 0, 0, 5), null, 'a plan with no moisture list is fine');
});

test('reading and air text', () => {
  const p = point(1, 0, 0, { type: 'wme' });
  const r = reading(14.26, 2, { rh: 48, temp: 72 });
  assert.equal(valueText(p, r), '14.3% WME');
  assert.match(airText(r), /^48% RH · 72°F · \d+ gpp$/);
  assert.equal(airText(reading(5, 2)), '');
  assert.equal(airText(reading(5, 2, { rh: 40 })), '40% RH');
});

test('moisture points are in the bounds and draw in every surface view, selected or not, without throwing', () => {
  const plan = { ...base(), moisture: [
    point(1, 3, 3, { surface: 'floor', goal: 12 }, [reading(25, 2, { rh: 55, temp: 74 }), reading(11, 4, { rh: 40, temp: 72 })]),
    point(2, 9, 2, { surface: 'wall' }, [reading(30, 2)]),
    point(3, 6, 8, { surface: 'ceiling' }),
  ] };
  assert.ok(planBounds({ ...plan, rooms: [] }).maxX >= 15);
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? (s) => ({ width: String(s).length * 7 }) : (typeof k === 'string' && !(k in t) ? (...a) => { calls.push([k, ...a]); } : t[k])), set: (t, k, v) => { t[k] = v; return true; } });
  const view = { scale: 20, ox: 10, oy: 10 };
  for (const surface of ['all', 'floor', 'wall', 'ceiling']) drawPlan(ctx, plan, view, { W: 400, H: 300, surface });
  drawPlan(ctx, plan, view, { W: 400, H: 300, selection: { kind: 'moisture', id: plan.moisture[2].id }, surface: 'floor' });
  drawPlan(ctx, plan, { scale: 3, ox: 0, oy: 0 }, { W: 400, H: 300 }); // zoomed far out
  drawPlan(ctx, plan, view, { W: 400, H: 300, moistLabels: false });
  const text = calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(text.includes('11% MC ↓'), `labels: ${text}`);
  assert.ok(text.some((t) => t.startsWith('40% RH')));
  assert.ok(text.includes('No reading'));
  assert.ok(text.includes('1') && text.includes('3'), 'pin numbers');
});

test('the moisture log has one row per reading, oldest first, with room, standard and status', () => {
  const plan = {
    ...base(),
    standards: { drywall: { val: 12, type: 'mc' } },
    moisture: [
      point(2, 3, 3, { surface: 'wall', material: 'drywall', h: 2 }, [reading(9, 5), reading(30, 2, { rh: 50, temp: 70, note: 'behind "fridge", left' })]),
      point(1, 8, 4, { surface: 'floor', material: 'hardwood', type: 'wme' }, [reading(19, 2)]),
    ],
  };
  const rows = moistureLogRows(plan);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r[1]), [1, 2, 2], 'same time: lower point number first, then the later date');
  assert.equal(rows[1][2], 'Kitchen');
  assert.equal(rows[1][4], 2);
  assert.equal(rows[1][11], 'Wet');
  assert.equal(rows[2][11], 'Dry');
  assert.equal(rows[0][10], '', 'no standard for hardwood');
  assert.equal(rows[0][11], '');
  const csv = moistureLogCsv(plan);
  assert.ok(csv.startsWith('\ufeffDay,Point,Room,Surface'));
  assert.ok(csv.includes('"behind ""fridge"", left"'));
  assert.equal(csv.trim().split('\r\n').length, 4);
  assert.equal(moistureLogCsv(base()).trim().split('\r\n').length, 1, 'just the header when there are no readings');
});

test('csv cells are quoted, and cannot run as a spreadsheet formula', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('@x'), "'@x");
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell(null), '');
});

test('areaLayers: one layer per affected area, named by kind and room', async () => {
  const { areaLayers } = await import('../lib/moistureLayers.js');
  const { emptyPlan, newArea } = await import('../lib/sketch.js');
  const plan = emptyPlan();
  plan.rooms.push({ id: 'r1', label: 'Kitchen', pts: [[0, 0], [12, 0], [12, 10], [0, 10]] });
  plan.rooms.push({ id: 'r2', label: 'Hall', pts: [[12, 0], [20, 0], [20, 10], [12, 10]] });
  const sq = (x, y) => [[x, y], [x + 4, y], [x + 4, y + 4], [x, y + 4]];
  plan.areas.push({ ...newArea(sq(1, 1), { kind: 'water', cat: 2, smooth: false, surfaces: ['floor', 'wall'] }), id: 'a1' });
  plan.areas.push({ ...newArea(sq(14, 2), { kind: 'water', cat: 2, smooth: false, surfaces: ['floor'] }), id: 'a2' });
  plan.areas.push({ ...newArea(sq(6, 5), { kind: 'water', cat: 2, smooth: false, surfaces: ['floor'] }), id: 'a3' });
  const layers = areaLayers(plan);
  assert.equal(layers.length, 3);
  assert.deepEqual(layers.map((l) => l.id), ['a1', 'a2', 'a3']);
  assert.match(layers[1].name, /Hall/);
  assert.equal(layers[0].detail, 'floor + wall');
  assert.notEqual(layers[0].name, layers[2].name); // two cat 2 areas in the Kitchen are numbered apart
  assert.equal(areaLayers(emptyPlan()).length, 0);
});

test('drawPlan: plain floorplan hides areas switched off', async () => {
  const { drawPlan } = await import('../lib/sketchDraw.js');
  const { emptyPlan, newArea } = await import('../lib/sketch.js');
  const plan = emptyPlan();
  plan.rooms.push({ id: 'r1', label: 'Kitchen', pts: [[0, 0], [12, 0], [12, 10], [0, 10]] });
  plan.areas.push({ ...newArea([[1, 1], [5, 1], [5, 5], [1, 5]], { kind: 'water', cat: 1, smooth: false }), id: 'a1' });
  const count = (opts) => {
    let n = 0;
    const ctx = new Proxy({}, { get: (_, k) => (k === 'fill' ? () => { n += 1; } : k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' || k === 'createPattern' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
    drawPlan(ctx, plan, { scale: 10, ox: 0, oy: 0 }, { W: 300, H: 200, plain: true, grid: false, ...opts });
    return n;
  };
  assert.ok(count({}) > count({ hiddenAreas: new Set(['a1']) }));
});

test('room numbers are handed out automatically and never repeat', async () => {
  const { emptyPlan, newRoom, ensureRoomNums, normalizePlan, roomTitle } = await import('../lib/sketch.js');
  let plan = emptyPlan();
  plan.rooms.push(newRoom('', 0, 0), newRoom('', 12, 0));
  plan = ensureRoomNums(plan);
  assert.deepEqual(plan.rooms.map((r) => r.num), [1, 2]);
  const copy = { ...plan.rooms[0], id: 'copy', num: 0 };
  plan = ensureRoomNums({ ...plan, rooms: [...plan.rooms, copy] });
  assert.deepEqual(plan.rooms.map((r) => r.num), [1, 2, 3]);
  // deleting room 2 does not renumber the rest, and the next room is 4
  plan = { ...plan, rooms: plan.rooms.filter((r) => r.num !== 2) };
  plan = ensureRoomNums({ ...plan, rooms: [...plan.rooms, newRoom('', 30, 0)] });
  assert.deepEqual(plan.rooms.map((r) => r.num), [1, 3, 4]);
  // a repeated number (a pasted copy) is fixed
  const dup = ensureRoomNums({ ...plan, rooms: [...plan.rooms, { ...plan.rooms[0], id: 'x' }] });
  assert.equal(new Set(dup.rooms.map((r) => r.num)).size, dup.rooms.length);
  // loading an old sketch numbers its rooms
  const old = normalizePlan({ v: 3, rooms: [{ id: 'a', label: 'Kitchen', pts: [[0, 0], [10, 0], [10, 10], [0, 10]] }, { id: 'b', pts: [[10, 0], [20, 0], [20, 10], [10, 10]] }] });
  assert.deepEqual(old.rooms.map((r) => r.num), [1, 2]);
  assert.equal(roomTitle(old.rooms[0]), 'Kitchen');
  assert.equal(roomTitle(old.rooms[1]), 'Room 2');
});

test('room type: standard types, Other with its own text, bad values dropped', async () => {
  const { normalizePlan, roomTitle, ROOM_TYPES } = await import('../lib/sketch.js');
  assert.ok(ROOM_TYPES.kitchen && ROOM_TYPES.bedroom && ROOM_TYPES.bathroom && ROOM_TYPES.living && ROOM_TYPES.other);
  const pts = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const p = normalizePlan({ v: 3, rooms: [
    { id: 'a', type: 'bedroom', pts }, { id: 'b', type: 'other', other: 'Sunroom', pts }, { id: 'c', type: 'bogus', other: 'x', pts }, { id: 'd', type: 'kitchen', other: 'ignored', pts },
  ] });
  assert.deepEqual(p.rooms.map((r) => r.type), ['bedroom', 'other', '', 'kitchen']);
  assert.deepEqual(p.rooms.map(roomTitle), ['Bedroom', 'Sunroom', 'Room 3', 'Kitchen']);
  assert.equal(p.rooms[3].other, '');
});

test('days: old readings are filed by date, a day view shows what was read that day, the summary has a column per day', async () => {
  const { normalizePlan } = await import('../lib/sketch.js');
  const { dayView, addDay, dayName, countOnDay } = await import('../lib/moistureDays.js');
  const { moistureSummaryCsv } = await import('../lib/moistureLog.js');
  const at = (d) => `2026-11-${d}T15:00:00`;
  let plan = normalizePlan({ v: 3, rooms: [{ id: 'r', label: 'Kitchen', pts: [[0, 0], [10, 0], [10, 10], [0, 10]] }],
    standards: { drywall: { val: 12, type: 'mc' } },
    moisture: [
      { id: 'p1', n: 1, x: 2, y: 2, material: 'drywall', readings: [{ id: 'a', at: at('10'), val: 40 }, { id: 'b', at: at('11'), val: 22 }, { id: 'c', at: at('12'), val: 11 }] },
      { id: 'p2', n: 2, x: 4, y: 4, material: 'drywall', readings: [{ id: 'd', at: at('10'), val: 35 }] },
    ] });
  assert.equal(plan.days.length, 3, 'a day for each date with readings');
  assert.deepEqual(plan.days.map((d) => d.date), ['2026-11-10', '2026-11-11', '2026-11-12']);
  const [d1, d2, d3] = plan.days;
  assert.equal(dayName(plan.days, d2.id), 'Day 2');
  assert.equal(countOnDay(plan, d2.id), 1);
  // Day 2: point 1 read (22, down from 40, still wet), point 2 not read yet
  const v2 = dayView(plan, d2.id);
  const s1 = moistureStatus(v2.moisture[0], goalFor(v2, v2.moisture[0]));
  assert.equal(s1.state, 'wet'); assert.equal(s1.trend, 'down'); assert.equal(s1.latest.val, 22);
  const s2 = moistureStatus(v2.moisture[1], goalFor(v2, v2.moisture[1]));
  assert.equal(s2.state, 'none'); assert.equal(s2.last.val, 35);
  // Day 3: point 1 is dry
  const v3 = dayView(plan, d3.id);
  assert.equal(moistureStatus(v3.moisture[0], goalFor(v3, v3.moisture[0])).state, 'dry');
  assert.equal(moistureCounts(v3).none, 1);
  // Day 1 only knows Day 1
  assert.equal(dayView(plan, d1.id).moisture[0].readings.length, 1);
  // adding a day: a new date is added in order, an existing date is reused
  const more = addDay(plan, '2026-11-13');
  assert.ok(more.added); assert.equal(more.plan.days.length, 4);
  assert.equal(addDay(more.plan, '2026-11-13').added, false);
  // the summary has a column per day and a final status
  const rows = moistureSummaryCsv(plan).trim().split('\r\n');
  assert.match(rows[0], /Day 1 \(Nov 10\),Day 2 \(Nov 11\),Day 3 \(Nov 12\),Status/);
  assert.match(rows[1], /,40,22,11,Dry$/);
  assert.match(rows[2], /,35,,,/);
  // it survives a save and load
  assert.equal(normalizePlan(JSON.parse(JSON.stringify(plan))).days.length, 3);
});

test('number pad: digits, one point, one decimal, backspace, and a leading zero gives way', () => {
  const type = (keys, opts) => [...keys].reduce((s, k) => padEdit(s, k === '<' ? 'back' : k, opts), '');
  assert.equal(type('14.2'), '14.2');
  assert.equal(type('14.25'), '14.2'); // one decimal place
  assert.equal(type('1.2.3'), '1.23'.slice(0, 3)); // a second point is ignored, the next digit would be a second decimal
  assert.equal(type('.5'), '0.5');
  assert.equal(type('07'), '7');
  assert.equal(type('0.'), '0.');
  assert.equal(type('123456'), '12345'); // five characters at most
  assert.equal(type('14.2<<'), '14');
  assert.equal(type('<<'), '');
  assert.equal(type('72.5', { decimals: 0 }), '725'); // whole numbers only: the point does nothing
  assert.equal(padEdit('12', 'x'), '12');
  assert.equal(padEdit(null, '5'), '5');
});
