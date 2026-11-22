import test from 'node:test';
import assert from 'node:assert/strict';
import { fabActions, FAB_HIDDEN_TABS } from '../lib/jobFab.js';

test('no sketch yet: Start Sketch, no recheck', () => {
  assert.deepEqual(fabActions({ hasSketch: false, visitStatus: null }), ['photos', 'sketch', 'internal']);
});

test('a sketch exists: Start Sketch goes away and Start Recheck shows', () => {
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: null }), ['photos', 'recheck', 'internal']);
});

test('Start Job before the visit starts, Complete Job after', () => {
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: 'scheduled' }), ['photos', 'recheck', 'otw', 'start', 'internal']);
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: 'on_the_way' }), ['photos', 'recheck', 'otw', 'start', 'internal']);
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: 'started' }), ['photos', 'recheck', 'complete', 'internal']);
  assert.deepEqual(fabActions({ hasSketch: false, visitStatus: 'started' }), ['photos', 'sketch', 'complete', 'internal']);
});

test('no visit to act on: no Start / Complete Job', () => {
  assert.deepEqual(fabActions({ hasSketch: false, visitStatus: 'finished' }), ['photos', 'sketch', 'internal']);
});

test('documentation tables missing: only Start Job is offered', () => {
  assert.deepEqual(fabActions({ hasSketch: false, visitStatus: 'scheduled', docsMissing: true }), ['otw', 'start']);
  assert.deepEqual(fabActions({ hasSketch: false, visitStatus: 'started', docsMissing: true }), []);
});

test('Take Photos is always first when the tables exist', () => {
  assert.equal(fabActions({})[0], 'photos');
  assert.ok(!fabActions({ docsMissing: true }).includes('photos'));
});

test('hidden on the sketch and moisture tabs', () => {
  assert.deepEqual(FAB_HIDDEN_TABS, ['sketch', 'moisture', 'thread']);
});

test('Chat is the top action when switched on, and off by default', () => {
  assert.deepEqual(fabActions({ hasSketch: false, visitStatus: null, chat: true }), ['chat', 'photos', 'sketch', 'internal']);
  assert.deepEqual(fabActions({ docsMissing: true, visitStatus: 'scheduled', chat: true }), ['chat', 'otw', 'start']);
  assert.ok(!fabActions({}).includes('chat'));
});

test('Clock Out while the job clock runs, Clock In when it is stopped, before Internal Update', () => {
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: 'started', clock: 'out' }), ['photos', 'recheck', 'complete', 'clock_out', 'internal']);
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: 'started', clock: 'in' }), ['photos', 'recheck', 'complete', 'clock_in', 'internal']);
  assert.deepEqual(fabActions({ hasSketch: false, visitStatus: null, clock: null }), ['photos', 'sketch', 'internal']);
  assert.ok(!fabActions({ visitStatus: 'started', clock: 'out' }).includes('clock_in'));
});

test('the clock buttons come with the chat on top and without the photo tables', () => {
  assert.deepEqual(fabActions({ hasSketch: false, visitStatus: 'started', chat: true, clock: 'out' }), ['chat', 'photos', 'sketch', 'complete', 'clock_out', 'internal']);
  assert.deepEqual(fabActions({ docsMissing: true, visitStatus: 'started', clock: 'out' }), ['clock_out']);
});

test('Start Job is left off for anyone the visit is not assigned to', () => {
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: 'scheduled', canStart: false }), ['photos', 'recheck', 'otw', 'internal']);
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: 'on_the_way', canStart: false }), ['photos', 'recheck', 'otw', 'internal']);
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: 'started', canStart: false }), ['photos', 'recheck', 'complete', 'internal']);
});
