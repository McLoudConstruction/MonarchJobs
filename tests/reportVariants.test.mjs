import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMoistureReport, REPORT_VARIANTS } from '../lib/moistureReport.js';
import { emptyPlan, newRoom } from '../lib/sketch.js';
import { makeMoisture, makeReading } from '../lib/moisture.js';
import { makeEquipment } from '../lib/equipment.js';
import { addDehuReading, makeDehuReading } from '../lib/dehuReadings.js';

function plan() {
  const p = emptyPlan();
  p.rooms = [newRoom('Kitchen', 0, 0, 12, 10)];
  p.days = [{ id: 'd1', date: '2026-11-10' }];
  const m = makeMoisture(3, 3, 1, { surface: 'floor', material: 'hardwood' });
  m.readings = [{ ...makeReading({ val: 18 }), day: 'd1', by: { id: 'u', name: 'Jordan Techman' } }];
  p.moisture = [m];
  let u = makeEquipment('dehu', 1, 4, 4, { day: 'd1', by: { id: 'u', name: 'Jordan Techman' } });
  u = addDehuReading(u, makeDehuReading({ day: 'd1', inRh: 60, inTemp: 78, outRh: 25, outTemp: 92 }));
  p.equipment = [u];
  return p;
}
const text = (bytes) => Buffer.from(bytes).toString('latin1');

test('every report variant builds a PDF, and none names a staff member', () => {
  for (const variant of Object.keys(REPORT_VARIANTS)) {
    const pdf = renderMoistureReport(plan(), { title: 'Test', variant, info: { business: 'Acme Restoration', customer: 'Pat Owner', address: '1 Main St', jobNumber: 12 } });
    const t = text(pdf);
    assert.ok(t.startsWith('%PDF'), variant);
    assert.ok(!t.includes('Jordan'), `${variant} must not name staff`);
  }
});

test('the header carries the company and the job, and the variants differ in length', () => {
  const full = text(renderMoistureReport(plan(), { variant: 'full', info: { business: 'Acme Restoration', customer: 'Pat Owner' } }));
  assert.ok(full.includes('Acme Restoration') && full.includes('Pat Owner'));
  const eq = text(renderMoistureReport(plan(), { variant: 'equipment' }));
  assert.ok(eq.includes('Equipment Report'));
  assert.ok(!eq.includes('Status by room'));
  const sum = text(renderMoistureReport(plan(), { variant: 'summary' }));
  assert.ok(sum.includes('Moisture Summary') && !sum.includes('Reading log'));
  assert.ok(full.includes('Dehumidifier performance'));
});
