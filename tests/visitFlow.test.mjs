import test from 'node:test';
import assert from 'node:assert/strict';
import { planTransition } from '../lib/visitFlow.js';

const now = new Date('2026-11-10T15:00:00Z');
const visit = (status) => ({ id: 'v1', status });

test('on the way requires 10-60 minutes in steps of 10 and sets the job on the way', () => {
  assert.ok(planTransition({ visit: visit('scheduled'), action: 'on_the_way', minutes: 25, now }).error);
  assert.ok(planTransition({ visit: visit('scheduled'), action: 'on_the_way', now }).error);
  const r = planTransition({ visit: visit('scheduled'), action: 'on_the_way', minutes: 30, now });
  assert.equal(r.visitPatch.minutes_out, 30);
  assert.equal(r.visitPatch.status, 'on_the_way');
  assert.equal(r.jobPatch.status, 'on_the_way');
});

test('on the way can be pressed again to update the ETA, but not after starting', () => {
  assert.equal(planTransition({ visit: visit('on_the_way'), action: 'on_the_way', minutes: 10, now }).visitPatch.minutes_out, 10);
  assert.ok(planTransition({ visit: visit('started'), action: 'on_the_way', minutes: 10, now }).error);
});

test('start works from scheduled or on the way; finish only from started', () => {
  assert.equal(planTransition({ visit: visit('scheduled'), action: 'started', now }).jobPatch.status, 'in_progress');
  assert.equal(planTransition({ visit: visit('on_the_way'), action: 'started', now }).visitPatch.status, 'started');
  assert.ok(planTransition({ visit: visit('scheduled'), action: 'finished', now }).error);
  assert.ok(planTransition({ visit: visit('finished'), action: 'started', now }).error);
  assert.ok(planTransition({ visit: visit('cancelled'), action: 'started', now }).error);
});

test('finishing the last visit completes the job; finishing with a return visit planned does not', () => {
  const done = planTransition({ visit: visit('started'), action: 'finished', othersActive: 0, now });
  assert.equal(done.jobPatch.status, 'completed');
  assert.equal(done.jobPatch.completed_at, now.toISOString());
  assert.equal(done.touchCustomerLastVisit, now.toISOString());
  const more = planTransition({ visit: visit('started'), action: 'finished', othersActive: 1, now });
  assert.equal(more.jobPatch.status, 'booked');
  assert.equal(more.jobPatch.completed_at, undefined);
});

test('unknown action is rejected', () => {
  assert.ok(planTransition({ visit: visit('scheduled'), action: 'explode', now }).error);
});
