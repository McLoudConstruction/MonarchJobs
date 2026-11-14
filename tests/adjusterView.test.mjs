import test from 'node:test';
import assert from 'node:assert/strict';
import { adjusterView } from '../lib/adjusterView.js';
import { emptyPlan, newRoom } from '../lib/sketch.js';
import { makeMoisture } from '../lib/moisture.js';
import { makeEquipment } from '../lib/equipment.js';
import { addDehuReading, makeDehuReading } from '../lib/dehuReadings.js';

test('the adjuster view has the drying, equipment and dehumidifier data and no staff names', () => {
  const p = emptyPlan();
  p.rooms = [newRoom('Kitchen', 0, 0, 12, 10)];
  p.days = [{ id: 'd1', date: '2026-11-10' }];
  const m = makeMoisture(3, 3, 1, { surface: 'floor', material: 'hardwood' });
  m.goal = 15;
  m.readings = [{ id: 'r1', day: 'd1', at: '2026-11-10T15:00:00Z', val: 12, rh: null, temp: null, note: 'behind fridge', by: { id: 'u', name: 'Jordan Techman' } }];
  p.moisture = [m];
  let u = makeEquipment('dehu', 1, 4, 4, { day: 'd1', by: { id: 'u', name: 'Jordan Techman' }, note: 'private note' });
  u = addDehuReading(u, makeDehuReading({ day: 'd1', inRh: 60, inTemp: 78, outRh: 25, outTemp: 92 }));
  p.equipment = [u];
  const v = adjusterView(p, 'Main floor');
  assert.equal(v.status.allDry, true);
  assert.equal(v.rooms[0].rows[0].state, 'dry');
  assert.equal(v.equipment.units.length, 1);
  assert.equal(v.dehu.length, 1);
  assert.ok(v.dehu[0].drop > 20);
  const text = JSON.stringify(v);
  assert.ok(!text.includes('Jordan') && !text.includes('behind fridge') && !text.includes('private note'));
});
