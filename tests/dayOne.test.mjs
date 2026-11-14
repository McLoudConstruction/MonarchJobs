import test from 'node:test';
import assert from 'node:assert/strict';
import { dayOneList, dayOneProgress } from '../lib/dayOne.js';
import { emptyPlan, newRoom, ensureRoomNums, newArea, rectPts } from '../lib/sketch.js';
import { makeMoisture } from '../lib/moisture.js';
import { makeEquipment } from '../lib/equipment.js';

test('an empty plan has only the first steps, none done', () => {
  const l = dayOneList(emptyPlan());
  assert.deepEqual(l.map((i) => i.id), ['rooms', 'source', 'water', 'standard', 'air']);
  assert.equal(dayOneProgress(l).done, 0);
});

test('items check themselves off as the sketch fills in', () => {
  const room = { ...newRoom('Kitchen', 0, 0, 12, 10), ceil: 9 };
  let p = ensureRoomNums({ ...emptyPlan(), rooms: [room], areas: [newArea(rectPts(0, 0, 8, 8), { kind: 'water', cat: 1, smooth: false, surfaces: ['floor'] })], days: [{ id: 'd1', date: '2026-11-10' }] });
  p.sources = [{ id: 's', x: 2, y: 2, surfaces: [], note: '' }];
  const m = makeMoisture(1, 3, 3, { surface: 'floor', material: 'hardwood' });
  m.readings = [{ id: 'r', day: 'd1', at: '2026-11-10T15:00:00Z', val: 20, rh: null, temp: null, note: '', by: { id: null, name: '' } }];
  p.moisture = [m];
  p.equipment = [makeEquipment('airmover', 1, 4, 4, { day: 'd1' })];
  const done = Object.fromEntries(dayOneList(p).map((i) => [i.id, i.done]));
  assert.equal(done.rooms, true); assert.equal(done.source, true); assert.equal(done.water, true);
  assert.equal(done.ceil, true); assert.equal(done.points, true); assert.equal(done.equipment, true);
  assert.equal(done.standard, false); assert.equal(done.air, false);
});
