import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLabel, SAVED_MS } from '../lib/saveStatus.js';

test('a save button reads Saving... then Saved, then its normal label', () => {
  assert.equal(saveLabel('idle', 'Save minimum'), 'Save minimum');
  assert.equal(saveLabel('saving', 'Save minimum'), 'Saving...');
  assert.equal(saveLabel('saved', 'Save minimum'), 'Saved');
});

test('Saved stays for 5 seconds', () => {
  assert.equal(SAVED_MS, 5000);
});
