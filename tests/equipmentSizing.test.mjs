import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlan, newRoom, ensureRoomNums, newArea, rectPts, normalizePlan } from '../lib/sketch.js';
import { makeEquipment, nextEquipNumber, cleanEquipment, pickUpUnit } from '../lib/equipment.js';
import { airMoversFor, dehuPints, classFromShare, sizePlan, airText, dehuText, DEFAULT_CEIL } from '../lib/equipmentSizing.js';

const by = { id: 'u1', name: 'Sam' };
const at = '2026-11-10T15:00:00.000Z';

// A 20 x 15 room (300 sq ft) with 140 sq ft of water on the floor, one day
function wetPlan(extra = {}) {
  const room = { ...newRoom('Living', 0, 0, 20, 15), ...extra };
  const water = newArea(rectPts(0, 0, 14, 10), { kind: 'water', cat: 1, smooth: false, surfaces: ['floor'] });
  return { ...ensureRoomNums({ ...emptyPlan(), rooms: [room], areas: [water] }), days: [{ id: 'd1', date: '2026-11-10' }, { id: 'd2', date: '2026-11-11' }] };
}
const put = (plan, t, day = 'd1', extra = {}) => ({ ...plan, equipment: [...plan.equipment, { ...makeEquipment(t, nextEquipNumber(plan.equipment, t), 5, 5, { day, at, by }), ...extra }] });

test('air movers: one for the room, plus floor and wall/ceiling shares, each rounded up', () => {
  assert.deepEqual(airMoversFor(300, 140, 0), { low: 1 + 2 + 0, high: 1 + 3 + 0 }); // 140/70 = 2, 140/50 = 2.8 -> 3
  assert.deepEqual(airMoversFor(300, 140, 100), { low: 1 + 2 + 1, high: 1 + 3 + 1 });
  assert.deepEqual(airMoversFor(300, 0, 151), { low: 1 + 0 + 2, high: 1 + 0 + 2 });
  assert.deepEqual(airMoversFor(24, 24, 24), { low: 1, high: 1 }); // under 25 sq ft: only the one
  assert.deepEqual(airMoversFor(25, 70, 0), { low: 2, high: 3 });
});

test('dehumidifier pints: volume over the class factor, rounded up', () => {
  assert.equal(dehuPints(1890, 2), 38); // 1,890 cu ft, class 2
  assert.equal(dehuPints(1890, 1), 19);
  assert.equal(dehuPints(1890, 3), 48);
  assert.equal(dehuPints(1890, 4), 48);
  assert.equal(dehuPints(0, 2), 0);
});

test('class from the share of surfaces affected', () => {
  assert.equal(classFromShare(0.02), 1);
  assert.equal(classFromShare(0.05), 2);
  assert.equal(classFromShare(0.4), 2);
  assert.equal(classFromShare(0.41), 3);
});

test('sizing a wet room: air movers, volume, class, and the ceiling assumption', () => {
  const s = sizePlan(wetPlan());
  assert.equal(s.wet, true);
  assert.equal(s.rooms.length, 1);
  assert.equal(s.assumed, 1);
  assert.equal(s.rooms[0].ceil, DEFAULT_CEIL);
  assert.equal(s.rooms[0].affected.floor, 140);
  assert.deepEqual([s.air.low, s.air.high], [3, 4]);
  assert.equal(s.dehu.volume, 300 * 8);
  // 140 affected over 300 + 300 + 20+... surfaces is well under 40% and over 5%: class 2
  assert.equal(s.dehu.cls, 2);
  assert.equal(s.dehu.pints, 48); // 2400 / 50
  const taller = sizePlan(wetPlan({ ceil: 10 }));
  assert.equal(taller.assumed, 0);
  assert.equal(taller.dehu.volume, 3000);
  assert.equal(taller.dehu.pints, 60);
});

test('a hand-set class wins over the automatic one', () => {
  const p = { ...wetPlan(), sizing: { cls: 3 } };
  const s = sizePlan(p);
  assert.equal(s.dehu.auto, 2);
  assert.equal(s.dehu.cls, 3);
  assert.equal(s.dehu.manual, true);
  assert.equal(s.dehu.pints, 60); // 2400 / 40
});

test('a plan with no water sizes nothing', () => {
  const s = sizePlan({ ...emptyPlan(), rooms: [newRoom('Dry', 0, 0, 10, 10)] });
  assert.equal(s.wet, false);
  assert.equal(s.air.low, 0);
  assert.match(airText(s), /Draw the water/);
  assert.match(dehuText(s), /Draw the water/);
});

test('placed, peak and status for air movers', () => {
  let p = wetPlan();
  assert.equal(sizePlan(p).air.status, 'none');
  p = put(p, 'airmover'); p = put(p, 'airmover');
  assert.equal(sizePlan(p).air.status, 'under'); // 2 placed, low is 3
  p = put(p, 'airmover', 'd2');
  const s = sizePlan(p);
  assert.equal(s.air.now, 3);
  assert.equal(s.air.status, 'ok');
  assert.equal(s.air.peak, 3);
  assert.match(airText(s), /3 to 4 needed/);
  // three on day 1, one picked up on day 2: 2 now, most at once still 3
  let q = wetPlan();
  for (let i = 0; i < 3; i += 1) q = put(q, 'airmover');
  const gone = { ...q, equipment: [pickUpUnit(q, q.equipment[0], { day: 'd2', at, by }), ...q.equipment.slice(1)] };
  const g = sizePlan(gone);
  assert.equal(g.air.now, 2); assert.equal(g.air.peak, 3);
});

test('dehumidifier status uses pints per day when every unit has a rating', () => {
  let p = wetPlan({ ceil: 10 }); // needs 60 pints at class 2
  assert.equal(sizePlan(p).dehu.status, 'none');
  p = put(p, 'dehu');
  assert.equal(sizePlan(p).dehu.status, 'unrated');
  assert.match(dehuText(sizePlan(p)), /add each unit/);
  p = { ...p, equipment: p.equipment.map((u) => ({ ...u, ppd: 45 })) };
  assert.equal(sizePlan(p).dehu.status, 'under');
  p = put(p, 'dehu', 'd1', { ppd: 45 });
  const s = sizePlan(p);
  assert.equal(s.dehu.nowPints, 90);
  assert.equal(s.dehu.status, 'ok');
  assert.match(dehuText(s), /60 pints per day needed/);
});

test('other equipment is listed but not sized, and pints per day survives saving', () => {
  let p = put(wetPlan(), 'scrubber');
  assert.deepEqual(sizePlan(p).other, { scrubber: 1 });
  const cleaned = cleanEquipment([{ ...makeEquipment('dehu', 1, 1, 1, { day: 'd1', at, by }), ppd: '70.4' }], (id) => id, new Set(['d1']));
  assert.equal(cleaned[0].ppd, 70);
  const none = cleanEquipment([{ ...makeEquipment('dehu', 1, 1, 1, { day: 'd1', at, by }), ppd: -5 }], (id) => id, new Set(['d1']));
  assert.equal('ppd' in none[0], false);
  assert.equal(normalizePlan({ ...p }).equipment.length, 1);
});

test('chambers are sized on their own, and rooms outside any chamber stay sized', async () => {
  const { cleanChambers, setChamber } = await import('../lib/chambers.js');
  const { newArea, rectPts } = await import('../lib/sketch.js');
  const mkRoom = (n, x) => newRoom(n, x, 0, 10, 10);
  const rooms = [mkRoom('A', 0), mkRoom('B', 12), mkRoom('C', 24)];
  const water = (room) => newArea(rectPts(room.pts[0][0], 0, 10, 10), { kind: 'water', cat: 1, smooth: false, surfaces: ['floor'] });
  let p = ensureRoomNums({ ...emptyPlan(), rooms, areas: rooms.map(water), days: [{ id: 'd1', date: '2026-11-10' }] });
  p.ceil = undefined;
  p.chambers = cleanChambers(setChamber([], { name: 'A and B', rooms: [rooms[0].id, rooms[1].id] }), new Set(rooms.map((r) => r.id)));
  const s = sizePlan(p);
  assert.equal(s.chambers.length, 2, 'the chamber and the leftover room');
  assert.equal(s.chambers[0].name, 'A and B');
  assert.ok(s.chambers[0].volume > s.chambers[1].volume);
  assert.equal(s.chambers[1].name, 'Other rooms');
  assert.deepEqual(cleanChambers([{ id: 'x', rooms: ['nope'] }], new Set(['a'])), []);
});
