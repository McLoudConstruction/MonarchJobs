import test from 'node:test';
import assert from 'node:assert/strict';
import { chamberStatus, pickupCheck, hasReadings, chamberOfUnit } from '../lib/chamberDry.js';
import { emptyPlan, newRoom, ensureRoomNums } from '../lib/sketch.js';
import { makeMoisture } from '../lib/moisture.js';
import { makeEquipment, pickUpUnit, cleanEquipment } from '../lib/equipment.js';

function plan({ kitchen = 12, hall = 25, chambers = [] } = {}) {
  const p = ensureRoomNums({ ...emptyPlan(), rooms: [newRoom('Kitchen', 0, 0, 12, 10), newRoom('Hall', 14, 0, 10, 10)] });
  p.days = [{ id: 'd1', date: '2026-11-10' }, { id: 'd2', date: '2026-11-11' }];
  const pt = (x, y, n, vals) => { const m = makeMoisture(n, x, y, { surface: 'floor', material: 'hardwood' }); m.goal = 15; m.readings = vals.map((v, i) => ({ id: `r${n}${i}`, day: `d${i + 1}`, at: `2026-11-1${i}T15:00:00Z`, val: v, rh: null, temp: null, note: '', by: { id: null, name: '' } })); return m; };
  p.moisture = [pt(3, 3, 1, [30, kitchen]), pt(16, 3, 2, [30, hall])];
  p.equipment = [makeEquipment('airmover', 1, 4, 4, { day: 'd1' }), makeEquipment('dehu', 1, 5, 5, { day: 'd1' }), makeEquipment('airmover', 2, 17, 4, { day: 'd1' }), makeEquipment('scrubber', 1, 6, 6, { day: 'd1' })];
  p.chambers = chambers;
  return p;
}

test('each room is its own chamber until rooms are grouped, and dries on its own', () => {
  const c = chamberStatus(plan());
  assert.equal(c.length, 2);
  const k = c.find((x) => x.roomIds.length === 1 && x.state === 'dry');
  const h = c.find((x) => x.state === 'drying');
  assert.ok(k && h);
  assert.equal(k.units.length, 2, 'air mover and dehumidifier, not the scrubber');
  assert.equal(h.wet, 1);
});

test('a grouped chamber is dry only when every room in it is', () => {
  const p = plan();
  const ids = p.rooms.map((r) => r.id);
  const c = chamberStatus({ ...p, chambers: [{ id: 'c1', name: 'Kitchen and hall', rooms: ids }] });
  assert.equal(c.length, 1);
  assert.equal(c[0].state, 'drying');
  assert.equal(chamberStatus({ ...plan({ hall: 10 }), chambers: [{ id: 'c1', name: 'Both', rooms: ids }] })[0].state, 'dry');
});

test('a chamber with equipment and no readings is flagged, not called dry', () => {
  const p = plan();
  p.moisture = p.moisture.slice(0, 1); // hall has no points
  const h = chamberStatus(p).find((c) => c.units.some((u) => u.n === 2));
  assert.equal(h.state, 'no_readings');
});

test('pick up is held for a chamber that is not dry, and allowed for one that is', () => {
  const p = plan();
  const kitchenUnits = p.equipment.filter((u) => u.n === 1 && u.t !== 'scrubber');
  assert.equal(pickupCheck(p, kitchenUnits).ok, true);
  const hallUnit = p.equipment.filter((u) => u.t === 'airmover' && u.n === 2);
  const r = pickupCheck(p, hallUnit);
  assert.equal(r.ok, false);
  assert.equal(r.held[0].units[0], 'AM 2');
  assert.match(r.held[0].why, /above the dry standard/);
  // air cleaning gear is never held
  assert.equal(pickupCheck(p, p.equipment.filter((u) => u.t === 'scrubber')).ok, true);
});

test('with no readings on the sketch nothing is held back', () => {
  const p = { ...plan(), moisture: [] };
  assert.equal(hasReadings(p), false);
  assert.equal(pickupCheck(p, p.equipment).ok, true);
});

test('an owner override reason stays on the pick-up entry', () => {
  const p = plan();
  const u = p.equipment[2];
  const picked = pickUpUnit(p, u, { day: 'd2', why: 'Customer needs the room back' });
  const last = picked.log[picked.log.length - 1];
  assert.equal(last.action, 'removed');
  assert.equal(last.why, 'Customer needs the room back');
  const cleaned = cleanEquipment([picked], (x) => x || 'id1', new Set(['d1', 'd2']));
  assert.equal(cleaned[0].log[cleaned[0].log.length - 1].why, 'Customer needs the room back');
  assert.equal(chamberOfUnit(p, u)?.roomIds.length, 1);
});
