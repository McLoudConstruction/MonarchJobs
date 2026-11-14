import test from 'node:test';
import assert from 'node:assert/strict';
import { backupAction } from '../lib/sketchBackup.js';

const plan = { rooms: [1] };
const edited = { rooms: [1, 2] };

test('a copy made on the same server version is restored', () => {
  assert.equal(backupAction({ plan: edited, base: 'T1' }, 'T1', plan), 'restore');
});
test('a copy made on an older server version is kept aside, never silently used or dropped', () => {
  assert.equal(backupAction({ plan: edited, base: 'T0' }, 'T1', plan), 'aside');
  assert.equal(backupAction({ plan: edited, base: null }, 'T1', plan), 'aside');
});
test('no copy, or a copy the server already has, needs nothing', () => {
  assert.equal(backupAction(null, 'T1', plan), 'none');
  assert.equal(backupAction({ plan, base: 'T1' }, 'T1', plan), 'none');
});
