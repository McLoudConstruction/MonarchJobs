import test from 'node:test';
import assert from 'node:assert/strict';
import { isExpired, validThrough, daysLeft, prettyDay, expiryNote } from '../lib/estimateExpiry.js';

// The database sets expires_at to the start of the day after the last valid day (Chicago time).
const EXP = '2026-12-02T06:00:00Z'; // Dec 2, 00:00 Chicago (CST, UTC-6): valid through Dec 1
const sent = (over = {}) => ({ status: 'sent', expires_at: EXP, ...over });

test('valid through the whole last day, in business time', () => {
  assert.equal(validThrough(EXP), '2026-12-01');
  assert.equal(validThrough(null), null);
  assert.equal(isExpired(sent(), new Date('2026-12-02T05:59:00Z')), false, 'still Dec 1 at 11:59 pm Chicago');
  assert.equal(isExpired(sent(), new Date('2026-12-02T06:00:00Z')), true);
  assert.equal(isExpired(sent(), new Date('2026-12-10T00:00:00Z')), true);
});

test('only a sent estimate with a date can expire', () => {
  const late = new Date('2027-01-01T00:00:00Z');
  assert.equal(isExpired(sent({ expires_at: null }), late), false, 'carpet or expiry off');
  assert.equal(isExpired(sent({ status: 'approved' }), late), false, 'approved stays approved');
  assert.equal(isExpired(sent({ status: 'declined' }), late), false);
  assert.equal(isExpired(null), false);
});

test('days left counts today', () => {
  assert.equal(daysLeft(EXP, new Date('2026-12-01T18:00:00Z')), 1, 'the last day');
  assert.equal(daysLeft(EXP, new Date('2026-11-28T18:00:00Z')), 4);
  assert.equal(daysLeft(EXP, new Date('2026-12-02T07:00:00Z')), 0);
  assert.equal(daysLeft(null), null);
});

test('the note under the status is calm and flags only the last days', () => {
  const n = (d) => expiryNote(sent(), new Date(`${d}T18:00:00Z`));
  assert.deepEqual(n('2026-11-20'), ['Valid through Dec 1, 2026 (12 days left).', 'info']);
  assert.deepEqual(n('2026-11-30'), ['Valid through Dec 1, 2026 (2 days left).', 'flag']);
  assert.deepEqual(n('2026-12-01'), ['Valid through Dec 1, 2026 (1 day left).', 'flag']);
  assert.deepEqual(n('2026-12-05'), ['Expired. It was valid through Dec 1, 2026.', 'flag']);
  assert.equal(expiryNote(sent({ expires_at: null })), null);
  assert.equal(expiryNote(sent({ status: 'approved' })), null);
});

test('dates read as words', () => {
  assert.equal(prettyDay('2026-01-05'), 'Jan 5, 2026');
  assert.equal(prettyDay(''), '');
});

test('daylight saving does not shift the last day', () => {
  // valid through Jul 15; start of Jul 16 Chicago (CDT, UTC-5)
  assert.equal(validThrough('2026-07-16T05:00:00Z'), '2026-07-15');
});
