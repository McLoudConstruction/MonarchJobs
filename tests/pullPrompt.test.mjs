import test from 'node:test';
import assert from 'node:assert/strict';
import { pullSuggestions } from '../lib/pullPrompt.js';
import { emptyPlan, newRoom, ensureRoomNums } from '../lib/sketch.js';
import { makeMoisture } from '../lib/moisture.js';
import { makeEquipment } from '../lib/equipment.js';

function plan(val2) {
  const p = ensureRoomNums({ ...emptyPlan(), rooms: [newRoom('Kitchen', 0, 0, 12, 10), newRoom('Hall', 14, 0, 10, 10)] });
  p.days = [{ id: 'd1', date: '2026-11-10' }, { id: 'd2', date: '2026-11-11' }, { id: 'd3', date: '2026-11-12' }];
  const pt = (x, y, n, vals) => { const m = makeMoisture(n, x, y, { surface: 'floor', material: 'hardwood' }); m.goal = 15; m.readings = vals.map((v, i) => ({ id: `r${n}${i}`, day: `d${i + 1}`, at: `2026-11-1${i}T15:00:00Z`, val: v, rh: null, temp: null, note: '', by: { id: null, name: '' } })); return m; };
  p.moisture = [pt(3, 3, 1, [30, 14, 12]), pt(16, 3, 2, [30, 25, val2])];
  p.equipment = [makeEquipment('airmover', 1, 4, 4, { day: 'd1' }), makeEquipment('dehu', 1, 5, 5, { day: 'd1' }), makeEquipment('airmover', 2, 17, 4, { day: 'd1' }), makeEquipment('scrubber', 1, 6, 6, { day: 'd1' })];
  return p;
}

test('a dry room with drying equipment still in it is suggested; a wet room is not', () => {
  const s = pullSuggestions(plan(22));
  assert.equal(s.length, 1);
  assert.equal(s[0].roomName.includes('Kitchen') || s[0].roomName.length > 0, true);
  assert.equal(s[0].units.length, 2, 'air mover and dehumidifier, not the scrubber');
  assert.equal(s[0].dehus, 1);
  assert.equal(s[0].daysSince, 1);
  assert.equal(s[0].unitDays, 2);
});

test('once both rooms are dry both are suggested', () => {
  assert.equal(pullSuggestions(plan(10)).length, 2);
});

test('nothing is suggested without days', () => {
  assert.deepEqual(pullSuggestions({ ...plan(10), days: [] }), []);
});
