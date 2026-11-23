import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTimeOffRequest, cleanSwapRequest, myOnCallWeeks, STATUS_TEXT } from '../lib/timeRequests.js';

test('time off request: needs dates, in order, not in the past, for the signed-in person only', () => {
  assert.ok(cleanTimeOffRequest({ starts_on: '', ends_on: '' }, 'me', '2026-11-23').error);
  assert.ok(cleanTimeOffRequest({ starts_on: '2026-12-05', ends_on: '2026-12-01' }, 'me', '2026-11-23').error);
  assert.match(cleanTimeOffRequest({ starts_on: '2026-11-01', ends_on: '2026-11-02' }, 'me', '2026-11-23').error, /passed/);
  const ok = cleanTimeOffRequest({ starts_on: '2026-12-01', ends_on: '', note: '  Trip  ', staff_id: 'someone-else' }, 'me', '2026-11-23');
  assert.deepEqual(ok.value, { staff_id: 'me', starts_on: '2026-12-01', ends_on: '2026-12-01', note: 'Trip' });
});

test('swap request checks times, length and who covers', () => {
  const now = new Date('2026-11-23T15:00:00Z');
  assert.ok(cleanSwapRequest({ from: '', to: '' }, 'me', now).error);
  assert.match(cleanSwapRequest({ from: '2026-11-25T14:00:00Z', to: '2026-11-25T13:00:00Z' }, 'me', now).error, /end after/);
  assert.match(cleanSwapRequest({ from: '2026-11-20T14:00:00Z', to: '2026-11-21T13:00:00Z' }, 'me', now).error, /passed/);
  assert.match(cleanSwapRequest({ from: '2026-11-25T14:00:00Z', to: '2027-03-01T13:00:00Z' }, 'me', now).error, /60 days/);
  assert.match(cleanSwapRequest({ from: '2026-11-25T14:00:00Z', to: '2026-11-27T14:00:00Z', cover_id: 'me' }, 'me', now).error, /someone else/);
  const ok = cleanSwapRequest({ from: '2026-11-25T14:00:00Z', to: '2026-11-27T14:00:00Z', cover_id: '', note: ' wedding ' }, 'me', now);
  assert.deepEqual(ok.value, { requester_id: 'me', starts_at: '2026-11-25T14:00:00.000Z', ends_at: '2026-11-27T14:00:00.000Z', cover_id: null, note: 'wedding' });
});

test('my on-call weeks lists only my weeks, with the handoff times', () => {
  const cfg = { tz: 'America/Chicago', oncall_order: ['a', 'b', 'c'], oncall_start: '2026-11-23', oncall_handoff_hour: 8, timeOff: [] };
  const weeks = myOnCallWeeks('b', cfg, 3, Date.parse('2026-11-23T16:00:00Z'));
  assert.deepEqual(weeks.map((w) => w.weekStart), ['2026-11-30', '2026-12-21', '2027-01-11']);
  assert.equal(new Date(weeks[0].startsAt).toISOString(), '2026-11-30T14:00:00.000Z');
  assert.equal(new Date(weeks[0].endsAt).toISOString(), '2026-12-07T14:00:00.000Z');
  assert.deepEqual(myOnCallWeeks('a', cfg, 1, Date.parse('2026-11-25T16:00:00Z')).map((w) => w.weekStart), ['2026-11-23']); // the week in progress still counts
});

test('status words are calm', () => {
  assert.equal(STATUS_TEXT.declined, 'Not approved');
});
