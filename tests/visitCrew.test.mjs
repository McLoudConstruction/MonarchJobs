import test from 'node:test';
import assert from 'node:assert/strict';
import { groupVisits, crewOf, planCrew, isReturnVisit } from '../lib/visitCrew.js';

const V = (id, tech, extra = {}) => ({ id, tech_id: tech, starts_at: '2026-11-20T18:00:00Z', status: 'scheduled', crew_id: null, ...extra });

test('visits with the same crew show as one group, lead first', () => {
  const g = groupVisits([V('b', 't2', { crew_id: 'a' }), V('a', 't1', { crew_id: 'a' }), V('c', 't3', { starts_at: '2026-11-21T18:00:00Z' })]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].members.map((m) => m.id), ['a', 'b']);
  assert.equal(g[0].solo, false);
  assert.equal(g[1].solo, true);
});

test('crewOf returns the visit alone when there is no crew, and skips cancelled members', () => {
  const a = V('a', 't1');
  assert.deepEqual(crewOf(a, [a]), [a]);
  const lead = V('a', 't1', { crew_id: 'a' });
  const list = [lead, V('b', 't2', { crew_id: 'a' }), V('c', 't3', { crew_id: 'a', status: 'cancelled' })];
  assert.deepEqual(crewOf(lead, list).map((v) => v.id), ['a', 'b']);
});

test('planCrew adds new people, removes unticked ones who have not started, and keeps the rest', () => {
  const rows = [V('a', 't1', { crew_id: 'a' }), V('b', 't2', { crew_id: 'a' }), V('c', 't3', { crew_id: 'a', status: 'started' })];
  const p = planCrew({ rows, leadTech: 't1', wanted: ['t4', 't1'] });
  assert.deepEqual(p.add, ['t4']);                       // the lead is never added twice
  assert.deepEqual(p.remove.map((r) => r.id), ['b']);   // t2 unticked and still scheduled
  assert.deepEqual(p.keep.map((r) => r.id), ['a', 'c']); // t3 already started, so stays
});

test('planCrew on a visit with nobody added only adds', () => {
  const p = planCrew({ rows: [V('a', 't1')], leadTech: 't1', wanted: ['t2', 't2', ''] });
  assert.deepEqual(p.add, ['t2']);
  assert.equal(p.remove.length, 0);
});

test('a crew mate who never started is not a return visit', () => {
  const fin = V('a', 't1', { crew_id: 'a', status: 'started' });
  assert.equal(isReturnVisit(V('b', 't2', { crew_id: 'a' }), fin), false);
  assert.equal(isReturnVisit(V('b', 't2', { crew_id: 'a', status: 'started' }), fin), true);
  assert.equal(isReturnVisit(V('z', 't2'), fin), true);
});
