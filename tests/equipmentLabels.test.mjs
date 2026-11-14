import test from 'node:test';
import assert from 'node:assert/strict';
import { equipmentLabelsPdf, qrMatrix, unitLink } from '../lib/equipmentLabels.js';
import { makeEquipment } from '../lib/equipment.js';

test('a label link carries the job and the unit', () => {
  assert.equal(unitLink('https://app.example.com/', 'job-1', 'ab12cd34'), 'https://app.example.com/jobs/job-1?unit=ab12cd34#moisture');
});

test('the QR is a square grid with the three finder corners', () => {
  const m = qrMatrix('https://app.example.com/jobs/x?unit=y#moisture');
  assert.equal(m.length, m[0].length);
  assert.ok(m.length >= 21);
  assert.equal(m[0][0] && m[0][m.length - 1] && m[m.length - 1][0], true);
});

test('a sheet of labels is a PDF with a page per ten units', () => {
  const units = Array.from({ length: 12 }, (_, i) => makeEquipment('airmover', i + 1, 1, 1, { day: 'd1' }));
  const pdf = equipmentLabelsPdf(units, { origin: 'https://app.example.com', jobId: 'job-1', jobNumber: 42 });
  const t = Buffer.from(pdf).toString('latin1');
  assert.ok(t.startsWith('%PDF'));
  assert.equal((t.match(/\/Type \/Page\b/g) || []).length, 2);
  assert.ok(t.includes('AM 12') && t.includes('Job #42'));
});
