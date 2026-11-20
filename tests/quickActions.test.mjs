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
