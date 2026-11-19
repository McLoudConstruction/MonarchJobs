import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLabor, cleanName, nameKey, entryMinutes, totalMinutes, minutesText, suggestNames, groupByCertification, MAX_ENTRIES } from '../lib/laborPool.js';

const NOW = new Date('2026-11-19T20:00:00Z');
const SIG = `data:image/png;base64,${'A'.repeat(300)}`;
const row = (over = {}) => ({ name: 'Jordan Ames', started_at: '2026-11-19T14:00:00Z', ended_at: '2026-11-19T18:30:00Z', ...over });

test('names: tidied, capped, matched without case', () => {
  assert.equal(cleanName('  jordan   ames '), 'jordan ames');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName('x'.repeat(200)).length, 80);
  assert.equal(nameKey('  Jordan  AMES'), 'jordan ames');
});

test('a good form passes and comes back clean', () => {
  const r = validateLabor({ entries: [row({ name: '  jordan   ames ', pool_id: 'p1' }), row({ name: 'Lee Cho', started_at: '2026-11-19T15:00:00Z' })], signature: SIG }, NOW);
  assert.equal(r.error, undefined);
  assert.equal(r.value.length, 2);
  assert.equal(r.value[0].name, 'jordan ames');
  assert.equal(r.value[0].pool_id, 'p1');
  assert.equal(r.value[1].pool_id, null);
  assert.equal(r.value[0].started_at, '2026-11-19T14:00:00.000Z');
});

test('it needs people, names, and sane times', () => {
  assert.ok(validateLabor({ entries: [], signature: SIG }, NOW).error);
  assert.ok(validateLabor({ entries: null, signature: SIG }, NOW).error);
  assert.match(validateLabor({ entries: [row({ name: ' ' })], signature: SIG }, NOW).error, /Row 1/);
  assert.match(validateLabor({ entries: [row({ started_at: '' })], signature: SIG }, NOW).error, /start and an end/);
  assert.match(validateLabor({ entries: [row({ ended_at: '2026-11-19T13:00:00Z' })], signature: SIG }, NOW).error, /after the start/);
  assert.match(validateLabor({ entries: [row({ started_at: '2026-11-18T10:00:00Z', ended_at: '2026-11-19T12:00:00Z' })], signature: SIG }, NOW).error, /at most 24 hours/);
  assert.match(validateLabor({ entries: [row({ ended_at: '2026-11-19T21:00:00Z' })], signature: SIG }, NOW).error, /future/);
  assert.match(validateLabor({ entries: [row({ started_at: '2026-10-01T14:00:00Z', ended_at: '2026-10-01T18:00:00Z' })], signature: SIG }, NOW).error, /30 days/);
});

test('the staff signature is required', () => {
  assert.match(validateLabor({ entries: [row()], signature: '' }, NOW).error, /Sign/);
  assert.match(validateLabor({ entries: [row()], signature: 'data:image/jpeg;base64,xxxx' }, NOW).error, /Sign/);
  assert.match(validateLabor({ entries: [row()], signature: 'data:image/png;base64,short' }, NOW).error, /Sign/);
  assert.match(validateLabor({ entries: [row()], signature: `data:image/png;base64,${'A'.repeat(700000)}` }, NOW).error, /too large/);
});

test('the same person cannot be on the form twice for overlapping hours, or overlap what is already saved', () => {
  const two = validateLabor({ entries: [row(), row({ name: 'JORDAN AMES', started_at: '2026-11-19T16:00:00Z', ended_at: '2026-11-19T19:00:00Z' })], signature: SIG }, NOW);
  assert.match(two.error, /already on this form/);
  // back to back is fine
  assert.equal(validateLabor({ entries: [row(), row({ started_at: '2026-11-19T18:30:00Z', ended_at: '2026-11-19T19:30:00Z' })], signature: SIG }, NOW).error, undefined);
  const saved = [{ worker_name: 'jordan ames', started_at: '2026-11-19T17:00:00Z', ended_at: '2026-11-19T19:00:00Z' }];
  assert.match(validateLabor({ entries: [row()], signature: SIG, existing: saved }, NOW).error, /already has time/);
  // a removed entry does not block
  assert.equal(validateLabor({ entries: [row()], signature: SIG, existing: [{ ...saved[0], voided_at: '2026-11-19T19:30:00Z' }] }, NOW).error, undefined);
  // someone else, same hours, is fine
  assert.equal(validateLabor({ entries: [row({ name: 'Lee Cho' })], signature: SIG, existing: saved }, NOW).error, undefined);
});

test('one form is limited in size', () => {
  const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => row({ name: `Helper ${i}` }));
  assert.match(validateLabor({ entries: many, signature: SIG }, NOW).error, /up to 30/);
  assert.equal(validateLabor({ entries: many.slice(0, MAX_ENTRIES), signature: SIG }, NOW).error, undefined);
});

test('minutes and totals', () => {
  assert.equal(entryMinutes(row()), 270);
  assert.equal(entryMinutes({ started_at: 'x', ended_at: 'y' }), 0);
  assert.equal(entryMinutes({ started_at: '2026-11-19T14:00:00Z', ended_at: '2026-11-19T13:00:00Z' }), 0);
  assert.equal(totalMinutes([row(), row({ voided_at: 'x' }), row({ started_at: '2026-11-19T16:30:00Z' })]), 270 + 120);
  assert.equal(minutesText(45), '45 min');
  assert.equal(minutesText(270), '4 h 30 min');
  assert.equal(minutesText(-5), '0 min');
});

test('suggestions come from the pool, starts-with first, without people already on the form', () => {
  const pool = [{ name: 'Jordan Ames' }, { name: 'Ana Jordan' }, { name: 'Lee Cho' }, { name: 'Retired Rae', active: false }];
  assert.deepEqual(suggestNames(pool, 'jor').map((p) => p.name), ['Jordan Ames', 'Ana Jordan']);
  assert.deepEqual(suggestNames(pool, '').map((p) => p.name), ['Jordan Ames', 'Ana Jordan', 'Lee Cho']);
  assert.deepEqual(suggestNames(pool, 'jor', ['jordan ames']).map((p) => p.name), ['Ana Jordan']);
  assert.deepEqual(suggestNames(pool, 'zzz'), []);
  assert.deepEqual(suggestNames(pool, '', [], 2).length, 2);
});

test('entries grouped by the signed form, newest form first, removed entries left out', () => {
  const certs = [{ id: 'c1', certified_at: '2026-11-18T20:00:00Z' }, { id: 'c2', certified_at: '2026-11-19T20:00:00Z' }, { id: 'c3', certified_at: '2026-11-19T21:00:00Z' }];
  const entries = [
    { id: 'e1', certification_id: 'c1', started_at: '2026-11-18T14:00:00Z', ended_at: '2026-11-18T16:00:00Z' },
    { id: 'e2', certification_id: 'c2', started_at: '2026-11-19T15:00:00Z', ended_at: '2026-11-19T16:00:00Z' },
    { id: 'e3', certification_id: 'c2', started_at: '2026-11-19T14:00:00Z', ended_at: '2026-11-19T16:00:00Z' },
    { id: 'e4', certification_id: 'c3', started_at: '2026-11-19T14:00:00Z', ended_at: '2026-11-19T16:00:00Z', voided_at: 'x' },
  ];
  const g = groupByCertification(certs, entries);
  assert.deepEqual(g.map((x) => x.cert.id), ['c2', 'c1']); // c3 has only a removed entry
  assert.deepEqual(g[0].entries.map((e) => e.id), ['e3', 'e2']);
  assert.equal(g[0].minutes, 180);
});
