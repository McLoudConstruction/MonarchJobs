import test from 'node:test';
import assert from 'node:assert/strict';
import { assetIdFromScan, checkScannedAsset } from '../lib/assetScan.js';

const ID = '3f2b8c1e-9a4d-4e6b-8c7a-1d2e3f4a5b6c';
const list = [
  { id: ID, tag: 'EQ-0007', type: 'dehu', status: 'available' },
  { id: 'b1', tag: 'EQ-0008', type: 'airmover', status: 'on_job' },
  { id: 'b2', tag: 'EQ-0009', type: 'truckmount', status: 'available' },
];

test('reads the id from a label address or a bare id', () => {
  assert.equal(assetIdFromScan(`https://jobs.example.com/equipment/${ID}`), ID);
  assert.equal(assetIdFromScan(`  https://x.test/equipment/${ID}?a=1 `), ID);
  assert.equal(assetIdFromScan(ID), ID);
  assert.equal(assetIdFromScan('https://example.com/menu'), '');
  assert.equal(assetIdFromScan(''), '');
  assert.equal(assetIdFromScan(null), '');
});

test('accepts an available drying tag and says when the type must change', () => {
  const r = checkScannedAsset(`https://x.test/equipment/${ID}`, list, { t: 'airmover' });
  assert.equal(r.ok, true);
  assert.equal(r.switchType, true);
  assert.equal(checkScannedAsset(ID, list, { t: 'dehu' }).switchType, false);
});

test('refuses foreign, unknown, busy and non-drying tags with a plain reason', () => {
  assert.match(checkScannedAsset('hello', list, { t: 'dehu' }).text, /not one of our/);
  assert.match(checkScannedAsset('/equipment/zzz', list, { t: 'dehu' }).text, /not in the equipment inventory/);
  assert.match(checkScannedAsset('/equipment/b1', list, { t: 'airmover' }).text, /on a job/);
  assert.match(checkScannedAsset('/equipment/b2', list, { t: 'airmover' }).text, /not drying equipment/);
});

test('the unit\'s own tag is accepted even when it shows as on a job', () => {
  const l = [{ id: 'b1', tag: 'EQ-0008', type: 'airmover', status: 'on_job' }];
  assert.equal(checkScannedAsset('/equipment/b1', l, { t: 'airmover', asset: 'b1' }).ok, true);
});
