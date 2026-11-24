import test from 'node:test';
import assert from 'node:assert/strict';
import { packetCheck } from '../lib/packetCheck.js';
import { emptyPlan, newRoom, ensureRoomNums } from '../lib/sketch.js';
import { makeMoisture } from '../lib/moisture.js';
import { makeEquipment, pickUpUnit } from '../lib/equipment.js';

const row = (kind, extra = {}) => ({ kind, created_at: '2026-11-24T10:00:00Z', data: {}, customer_absent: false, ...extra });
function plan({ hall = 12, pickAll = false } = {}) {
  const p = ensureRoomNums({ ...emptyPlan(), rooms: [newRoom('Kitchen', 0, 0, 12, 10)] });
  p.days = [{ id: 'd1', date: '2026-11-10' }, { id: 'd2', date: '2026-11-11' }];
  const m = makeMoisture(1, 3, 3, { surface: 'floor', material: 'hardwood' });
  m.goal = 15;
  m.readings = [30, hall].map((v, i) => ({ id: `r${i}`, day: `d${i + 1}`, at: `2026-11-1${i}T15:00:00Z`, val: v, rh: null, temp: null, note: '', by: { id: null, name: '' } }));
  p.moisture = [m];
  p.equipment = [makeEquipment('airmover', 1, 4, 4, { day: 'd1' })];
  if (pickAll) p.equipment = p.equipment.map((u) => pickUpUnit(p, u, { day: 'd2' }));
  return p;
}
const full = [row('safety'), row('authorization'), row('walkthrough', { data: { category: 2 } }), row('certificate')];
const byId = (r, id) => r.items.find((i) => i.id === id);

test('an empty job lists every gap with where to fix it', () => {
  const r = packetCheck({});
  assert.ok(r.gaps >= 5);
  assert.match(byId(r, 'authorization').detail, /Day 1 steps/);
  assert.equal(byId(r, 'sketch').ok, false);
});

test('a finished, dry, picked-up job with every document is clean', () => {
  const photos = [{ id: 'p1', room_key: null }];
  const p = plan({ pickAll: true });
  const roomId = p.rooms[0].id;
  const r = packetCheck({ steps: full, photos: [{ id: 'p1', room_key: roomId }], plans: [p] });
  assert.deepEqual(r.items.filter((i) => !i.ok).map((i) => i.id), []);
  assert.equal(r.early, 0);
  assert.ok(photos.length);
});

test('a wet chamber, equipment still out and an unsigned certificate show as gaps', () => {
  const r = packetCheck({ steps: [...full.slice(0, 3), row('certificate', { customer_absent: true })], photos: [{ id: 'p1' }], plans: [plan({ hall: 25 })] });
  assert.equal(byId(r, 'dry').ok, false);
  assert.match(byId(r, 'equipment').detail, /AM 1/);
  assert.match(byId(r, 'certificate').detail, /e-sign/);
});

test('early pick-ups with a reason are counted for the packet', () => {
  const p = plan({ hall: 25 });
  p.equipment = p.equipment.map((u) => pickUpUnit(p, u, { day: 'd2', why: 'Customer needs the room' }));
  assert.equal(packetCheck({ steps: full, photos: [], plans: [p] }).early, 1);
});
