import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOCK_REASONS, OTHER_REASON } from '../lib/clockReasons.js';

test('reasons end with Other, are short enough for the 300 character limit, and are unique', () => {
  assert.equal(CLOCK_REASONS[CLOCK_REASONS.length - 1], OTHER_REASON);
  assert.equal(new Set(CLOCK_REASONS).size, CLOCK_REASONS.length);
  for (const r of CLOCK_REASONS) assert.ok(r.length > 0 && r.length <= 300);
});
