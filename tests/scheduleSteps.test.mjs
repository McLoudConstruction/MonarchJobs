import test from 'node:test';
import assert from 'node:assert/strict';
import { DURATION_CHOICES } from '../lib/format.js';
import { SNAP_MINUTES } from '../lib/weekGrid.js';

test('appointment lengths step by 15 minutes, matching the start time and the schedule grid', () => {
  assert.equal(SNAP_MINUTES, 15);
  assert.equal(DURATION_CHOICES[0], 15);
  assert.equal(DURATION_CHOICES.at(-1), 480);
  assert.ok(DURATION_CHOICES.every((m, i) => m % 15 === 0 && (i === 0 || m - DURATION_CHOICES[i - 1] === 15)));
  assert.ok(DURATION_CHOICES.includes(240)); // the 4 hour default is still on the list
});
