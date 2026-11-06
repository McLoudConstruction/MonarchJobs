import test from 'node:test';
import assert from 'node:assert/strict';
import { findConflicts, doubleBookedIds, overlaps } from '../lib/schedule.js';

const v = (id, tech, s, e, status = 'scheduled') => ({
  id, tech_id: tech, starts_at: `2026-11-10T${s}:00Z`, ends_at: `2026-11-10T${e}:00Z`, status,
});

test('back-to-back visits do not overlap', () => {
  assert.equal(overlaps('2026-11-10T09:00:00Z', '2026-11-10T11:00:00Z', '2026-11-10T11:00:00Z', '2026-11-10T12:00:00Z'), false);
  assert.equal(overlaps('2026-11-10T09:00:00Z', '2026-11-10T11:00:01Z', '2026-11-10T11:00:00Z', '2026-11-10T12:00:00Z'), true);
});

test('findConflicts only reports same tech, active, overlapping visits and honors excludeId', () => {
  const visits = [
    v('a', 't1', '09:00', '11:00'),
    v('b', 't2', '09:00', '11:00'),
    v('c', 't1', '09:00', '11:00', 'cancelled'),
    v('d', 't1', '09:00', '11:00', 'finished'),
    v('e', 't1', '13:00', '14:00'),
  ];
  const range = { techId: 't1', start: '2026-11-10T10:00:00Z', end: '2026-11-10T12:00:00Z' };
  assert.deepEqual(findConflicts(visits, range).map((x) => x.id), ['a']);
  assert.deepEqual(findConflicts(visits, { ...range, excludeId: 'a' }), []);
  assert.deepEqual(findConflicts(visits, { ...range, techId: null }), []);
});

test('doubleBookedIds flags every overlapping visit, including chains, and ignores other techs', () => {
  const visits = [
    v('a', 't1', '09:00', '11:00'),
    v('b', 't1', '10:00', '12:00'),
    v('c', 't1', '11:30', '13:00'),
    v('d', 't1', '15:00', '16:00'),
    v('e', 't2', '09:00', '11:00'),
    v('f', 't1', '09:30', '10:30', 'cancelled'),
  ];
  assert.deepEqual([...doubleBookedIds(visits)].sort(), ['a', 'b', 'c']);
});
