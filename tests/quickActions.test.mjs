import test from 'node:test';
import assert from 'node:assert/strict';
import { quickActions, isTabAction } from '../lib/quickActions.js';

const keys = (o) => quickActions(o).map((a) => a.key);

test('a waiting visit offers On the way and Start job first', () => {
  assert.deepEqual(keys({ service: 'carpet', visitStatus: 'scheduled' }).slice(0, 2), ['otw', 'start']);
  assert.deepEqual(keys({ service: 'carpet', visitStatus: 'on_the_way' }).slice(0, 2), ['start', 'eta']);
});

test('a started visit offers the clock and Finish job', () => {
  assert.deepEqual(keys({ visitStatus: 'started', clock: 'out' }).slice(0, 2), ['clock_out', 'finish']);
  assert.deepEqual(keys({ visitStatus: 'started', clock: 'in' }).slice(0, 2), ['clock_in', 'finish']);
});

test('carpet gets Inspection and Eval sheet, never Moisture or Recheck', () => {
  const k = keys({ service: 'carpet', visitStatus: 'started', tabs: ['inspection', 'evalsheet', 'sketch', 'estimate', 'moisture'], hasSketch: true });
  assert.ok(k.includes('inspection') && k.includes('evalsheet'));
  assert.ok(!k.includes('moisture') && !k.includes('recheck'));
});

test('mitigation gets Moisture, and Recheck only with a sketch', () => {
  const tabs = ['moisture', 'sketch'];
  assert.ok(keys({ service: 'mitigation', tabs, hasSketch: true }).includes('recheck'));
  assert.ok(!keys({ service: 'mitigation', tabs, hasSketch: false }).includes('recheck'));
  assert.ok(!keys({ service: 'mitigation', tabs, hasSketch: true }).includes('inspection'));
});

test('tab actions only show when the tab is open to the person', () => {
  assert.ok(!keys({ service: 'carpet', tabs: [] }).includes('inspection'));
  assert.ok(!keys({ tabs: ['estimate'] }).includes('costs'));
});

test('a closed job offers no visit or work actions', () => {
  assert.deepEqual(keys({ jobStatus: 'closed', visitStatus: 'started', clock: 'out', tabs: ['invoice'] }), ['chat', 'invoice']);
});

test('isTabAction', () => { assert.ok(isTabAction('moisture')); assert.ok(!isTabAction('start')); });

test('Start job only shows for the team member the visit is assigned to', () => {
  assert.deepEqual(keys({ service: 'carpet', visitStatus: 'scheduled', canStart: false }).slice(0, 1), ['otw']);
  assert.ok(!keys({ service: 'carpet', visitStatus: 'scheduled', canStart: false }).includes('start'));
  assert.deepEqual(keys({ service: 'carpet', visitStatus: 'on_the_way', canStart: false }).slice(0, 1), ['eta']);
  assert.ok(!keys({ service: 'carpet', visitStatus: 'on_the_way', canStart: false }).includes('start'));
  // the default stays on, and a started visit still offers Finish job
  assert.ok(keys({ service: 'carpet', visitStatus: 'scheduled' }).includes('start'));
  assert.ok(keys({ service: 'carpet', visitStatus: 'started', canStart: false }).includes('finish'));
});

test('screens opened from Quick Actions have a title, falling back to the tab name', async () => {
  const { qaScreenTitle } = await import('../lib/quickActions.js');
  assert.equal(qaScreenTitle('evalsheet'), 'Eval sheet');
  assert.equal(qaScreenTitle('moisture'), 'Moisture');
  assert.equal(qaScreenTitle('unknown', 'Something'), 'Something');
  assert.equal(qaScreenTitle('unknown'), 'Job');
});
