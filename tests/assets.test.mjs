import test from 'node:test';
import assert from 'node:assert/strict';
import { assetTag, assetLink, cleanAssetForm, assetUsage, assetChanges } from '../lib/assets.js';
import { assetLabelsPdf, labelOrigin, PER_SHEET } from '../lib/assetLabels.js';
import { makeEquipment, pickUpUnit, unitAt } from '../lib/equipment.js';

test('asset numbers and links', () => {
  assert.equal(assetTag('mj', 7), 'MJ-0007');
  assert.equal(assetTag('', 12345), 'EQ-12345');
  assert.equal(assetLink('https://x.com/', 'abc'), 'https://x.com/equipment/abc');
});

test('the add form is cleaned and checked', () => {
  assert.ok(cleanAssetForm({ type: '' }).error);
  assert.ok(cleanAssetForm({ type: 'dehu', ppd: '0' }).error);
  assert.deepEqual(cleanAssetForm({ type: 'dehu', ppd: '70', label: ' Dri-Eaz LGR 3500i ', serial: 'A1' }).value, { type: 'dehu', label: 'Dri-Eaz LGR 3500i', serial: 'A1', ppd: 70, notes: '' });
  assert.equal(cleanAssetForm({ type: 'airmover' }).value.ppd, null);
});

test('labels sit on the 2 x 4 inch grid, ten to a sheet', () => {
  assert.equal(PER_SHEET, 10);
  const a = labelOrigin(0); const b = labelOrigin(1); const c = labelOrigin(2);
  assert.equal(Math.round(a.x * 100) / 100, 11.25);
  assert.equal(a.y, 36);
  assert.equal(b.x - a.x, 4 * 72 + 13.5);
  assert.equal(c.y - a.y, 144);
  assert.deepEqual(labelOrigin(10), labelOrigin(0), 'the eleventh label starts a new sheet');
});

test('a sheet prints the tag and starts part way down a used sheet', () => {
  const assets = Array.from({ length: 4 }, (_, i) => ({ id: `id${i}`, asset_no: i + 1, type: 'airmover', label: 'Fan', serial: '' }));
  const pdf = Buffer.from(assetLabelsPdf(assets, { origin: 'https://x.com', prefix: 'MJ', business: 'Acme', startAt: 9 })).toString('latin1');
  assert.ok(pdf.startsWith('%PDF'));
  assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, 2, '2 labels fit on the first sheet from position 9, 2 more on the next');
  assert.ok(pdf.includes('MJ-0004'));
});

test('the inventory follows what is on site on a job', () => {
  const plan = { days: [{ id: 'd1', date: '2026-11-10' }, { id: 'd2', date: '2026-11-11' }] };
  const u1 = { ...makeEquipment('dehu', 1, 1, 1, { day: 'd1' }), asset: 'A' };
  const u2 = { ...makeEquipment('airmover', 1, 2, 2, { day: 'd1' }), asset: 'B' };
  plan.equipment = [u1, u2];
  let usage = assetUsage(plan, unitAt);
  let ch = assetChanges(usage, [{ id: 'B', job_id: 'job1' }], 'job1');
  assert.deepEqual(ch.claim.map((c) => c.id).sort(), ['A', 'B']);
  assert.deepEqual(ch.release, []);
  plan.equipment = [u1, pickUpUnit(plan, u2, { day: 'd2' })];
  usage = assetUsage(plan, unitAt);
  ch = assetChanges(usage, [{ id: 'A', job_id: 'job1' }, { id: 'B', job_id: 'job1' }, { id: 'C', job_id: 'other' }], 'job1');
  assert.deepEqual(ch.claim.map((c) => c.id), ['A']);
  assert.deepEqual(ch.release, ['B'], 'picked up here: freed; another job\'s asset is left alone');
});

test('a unit keeps a valid asset id and drops a bad one', async () => {
  const { cleanEquipment } = await import('../lib/equipment.js');
  const mk = (asset) => ({ ...makeEquipment('dehu', 1, 1, 1, { day: 'd1' }), asset });
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const out = cleanEquipment([mk(id), mk('nope')], (x) => x || 'u' + Math.random(), new Set(['d1']));
  assert.equal(out[0].asset, id);
  assert.equal(out[1].asset, undefined);
});
