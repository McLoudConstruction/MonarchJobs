import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVAL_STATUSES, EVAL_PICKABLE, cleanProperty, blankProperty, daysBefore, filterEvals, groupByProperty, evalRowSize, centsText, newEvalData,
} from '../lib/evals.js';

const row = (o) => ({ id: o.id, property_id: o.p, status: o.s || 'todo', total_cents: o.c || 0, eval_date: o.d || null, created_at: o.created || '2026-11-01T12:00:00Z', data: { building: o.b || '', unit: o.u || '', size: o.size || '', notes: o.n || '' } });

test('statuses: converted is shown but not picked by hand', () => {
  assert.deepEqual(Object.keys(EVAL_STATUSES), ['todo', 'done', 'quoted', 'converted']);
  assert.ok(!EVAL_PICKABLE.includes('converted'));
});

test('cleanProperty needs a name and a real email', () => {
  assert.equal(cleanProperty(blankProperty()).ok, false);
  const good = cleanProperty({ name: '  Oak Ridge ', manager_email: 'Pat@Oak.com ' });
  assert.equal(good.ok, true);
  assert.equal(good.value.name, 'Oak Ridge');
  assert.equal(good.value.manager_email, 'pat@oak.com');
  const bad = cleanProperty({ name: 'Oak', maint_email: 'not-an-email' });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.emailErrors, ['Maintenance supervisor']);
  assert.equal(bad.value.maint_email, '');
});

test('daysBefore counts across month ends', () => {
  assert.equal(daysBefore('2026-11-20', 0), '2026-11-20');
  assert.equal(daysBefore('2026-11-02', 6), '2026-10-27');
  assert.equal(daysBefore('2026-03-01', 1), '2026-02-28');
  assert.equal(daysBefore('nope', 3), '');
});

test('filterEvals by property, status, date and search', () => {
  const list = [
    row({ id: 'a', p: 'p1', s: 'todo', d: '2026-11-20', b: 'B1', u: '101' }),
    row({ id: 'b', p: 'p1', s: 'done', d: '2026-11-10', b: 'B1', u: '102', n: 'pet odor' }),
    row({ id: 'c', p: 'p2', s: 'done', d: '2026-09-01', b: 'C', u: '5' }),
    row({ id: 'd', p: 'p2', s: 'quoted', d: null, created: '2026-11-19T10:00:00Z', u: '6' }),
  ];
  const ids = (f) => filterEvals(list, { today: '2026-11-20', ...f }).map((e) => e.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids({ propertyId: 'p2' }), ['c', 'd']);
  assert.deepEqual(ids({ status: 'done' }), ['b', 'c']);
  assert.deepEqual(ids({ range: 'today' }), ['a']);
  assert.deepEqual(ids({ range: 'week' }), ['a', 'd']); // d has no sheet date: its added day counts
  assert.deepEqual(ids({ range: 'month' }), ['a', 'b', 'd']);
  assert.deepEqual(ids({ q: 'PET' }), ['b']);
  assert.deepEqual(ids({ q: '101' }), ['a']);
  assert.deepEqual(ids({ propertyId: 'p1', status: 'done', range: 'month' }), ['b']);
});

test('groupByProperty: properties by name, units in natural order, totals added', () => {
  const props = [{ id: 'p1', name: 'Zephyr Apts' }, { id: 'p2', name: 'Aspen Court' }];
  const list = [
    row({ id: 'a', p: 'p1', b: 'B', u: '10', c: 8000 }),
    row({ id: 'b', p: 'p1', b: 'B', u: '2', c: 6000 }),
    row({ id: 'c', p: 'p1', b: 'A', u: '300', c: 10000 }),
    row({ id: 'd', p: 'p2', u: '1', c: 5000 }),
    row({ id: 'e', p: 'gone', u: '9', c: 100 }),
  ];
  const g = groupByProperty(list, props);
  assert.deepEqual(g.map((x) => x.property.name), ['Aspen Court', 'No property', 'Zephyr Apts']);
  const z = g.find((x) => x.property.id === 'p1');
  assert.deepEqual(z.evals.map((e) => e.id), ['c', 'b', 'a']);
  assert.equal(z.totalCents, 24000);
  assert.equal(z.count, 3);
});

test('row helpers and a new eval', () => {
  assert.equal(evalRowSize(row({ id: 'x', size: '2' })), '2 Bedroom');
  assert.equal(evalRowSize(row({ id: 'x' })), '');
  assert.equal(centsText(14000), '$140.00');
  assert.equal(centsText(null), '$0.00');
  const d = newEvalData({ property: { name: 'Oak' }, previous: row({ id: 'p', b: 'B7', u: '3' }), today: '2026-11-20' });
  assert.equal(d.complex, 'Oak');
  assert.equal(d.building, 'B7');
  assert.equal(d.unit, '');
  assert.equal(d.date, '2026-11-20');
});

test('eval photo paths sit under the eval id', async () => {
  const { evalPhotoPaths, EVAL_BUCKET, EVAL_PHOTO_KINDS } = await import('../lib/evals.js');
  assert.deepEqual(evalPhotoPaths('e1', 'p1'), { full: 'e1/p1.jpg', thumb: 'e1/p1_t.jpg' });
  assert.equal(EVAL_BUCKET, 'eval-photos');
  assert.deepEqual(Object.keys(EVAL_PHOTO_KINDS), ['unit', 'paper']);
});
