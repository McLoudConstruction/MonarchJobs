import test from 'node:test';
import assert from 'node:assert/strict';
import { fabActions, FAB_HIDDEN_TABS } from '../lib/jobFab.js';

test('no sketch yet: Start Sketch, no recheck', () => {
  assert.deepEqual(fabActions({ hasSketch: false, visitStatus: null }), ['sketch']);
});

test('a sketch exists: Start Sketch goes away and Start Recheck shows', () => {
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: null }), ['recheck']);
});

test('Start Job before the visit starts, Complete Job after', () => {
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: 'scheduled' }), ['recheck', 'start']);
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: 'on_the_way' }), ['recheck', 'start']);
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: 'started' }), ['recheck', 'complete']);
  assert.deepEqual(fabActions({ hasSketch: false, visitStatus: 'started' }), ['sketch', 'complete']);
});

test('no visit to act on: no Start / Complete Job', () => {
  assert.deepEqual(fabActions({ hasSketch: false, visitStatus: 'finished' }), ['sketch']);
});

test('documentation tables missing: only Start Job is offered', () => {
  assert.deepEqual(fabActions({ hasSketch: false, visitStatus: 'scheduled', docsMissing: true }), ['start']);
  assert.deepEqual(fabActions({ hasSketch: false, visitStatus: 'started', docsMissing: true }), []);
});

test('hidden on the sketch and moisture tabs', () => {
  assert.deepEqual(FAB_HIDDEN_TABS, ['sketch', 'moisture']);
});
