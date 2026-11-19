import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VISIT_REASONS, reasonsFor, reasonText, needsReason, techsOnJob, defaultGobackTech, checkVisitReason, gobackCounts, isFaultReason,
} from '../lib/visitReasons.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

test('reasons: every one has a key and a label, keys are unique, Other is last', () => {
  const keys = VISIT_REASONS.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(VISIT_REASONS.every((r) => r.key && r.label));
  assert.equal(keys[keys.length - 1], 'other');
});

test('the three tech-failure reasons are go-backs, nothing else is', () => {
  assert.deepEqual(VISIT_REASONS.filter((r) => r.fault).map((r) => r.key), ['tech_missed', 'tech_redo', 'tech_forgot']);
  assert.equal(isFaultReason('tech_redo'), true);
  assert.equal(isFaultReason('customer_request'), false);
  assert.equal(isFaultReason('other'), false);
});

test('reasons follow the service, and a job with no service gets them all', () => {
  const carpet = reasonsFor('carpet').map((r) => r.key);
  assert.ok(carpet.includes('spots_returned'));
  assert.ok(!carpet.includes('recheck'));
  assert.ok(!carpet.includes('equipment_pickup'));
  const mit = reasonsFor('mitigation').map((r) => r.key);
  assert.ok(mit.includes('recheck') && mit.includes('equipment_pickup'));
  assert.ok(!mit.includes('spots_returned'));
  assert.equal(reasonsFor('').length, VISIT_REASONS.length);
  for (const s of ['carpet', 'extraction', 'mitigation', 'remediation', '']) {
    const k = reasonsFor(s).map((r) => r.key);
    assert.ok(k.includes('other') && k.includes('tech_missed'), s);
  }
});

test('the first visit needs no reason, later ones do; cancelled visits do not count', () => {
  assert.equal(needsReason([]), false);
  assert.equal(needsReason([{ status: 'cancelled' }]), false);
  assert.equal(needsReason([{ status: 'scheduled' }]), true);
  assert.equal(needsReason([{ status: 'finished' }, { status: 'cancelled' }]), true);
});

test('checking the reason: none needed', () => {
  assert.deepEqual(checkVisitReason({ needed: false, reason: 'bogus' }), { value: { reason: '', reason_note: '', goback_tech: null } });
});

test('checking the reason: a reason has to be picked, and has to be on the list', () => {
  assert.ok(checkVisitReason({ reason: '' }).error);
  assert.ok(checkVisitReason({ reason: 'made_up' }).error);
  assert.deepEqual(checkVisitReason({ reason: 'customer_request' }).value, { reason: 'customer_request', reason_note: '', goback_tech: null });
});

test('checking the reason: Other needs words', () => {
  assert.ok(checkVisitReason({ reason: 'other', note: '  ' }).error);
  assert.ok(checkVisitReason({ reason: 'other', note: 'hi' }).error);
  assert.deepEqual(checkVisitReason({ reason: 'other', note: '  Waiting   on the adjuster ' }).value, { reason: 'other', reason_note: 'Waiting on the adjuster', goback_tech: null });
});

test('checking the reason: a tech failure needs a tech, and is logged against them', () => {
  assert.ok(checkVisitReason({ reason: 'tech_missed' }).error);
  assert.ok(checkVisitReason({ reason: 'tech_missed', gobackTech: 'nobody' }).error);
  assert.deepEqual(checkVisitReason({ reason: 'tech_redo', gobackTech: T1, note: 'Streaks in hallway' }).value, { reason: 'tech_redo', reason_note: 'Streaks in hallway', goback_tech: T1 });
  // a tick or a tech on a reason that is not a failure changes nothing
  assert.equal(checkVisitReason({ reason: 'materials', gobackChecked: true, gobackTech: T1 }).value.goback_tech, null);
});

test('checking the reason: Other can be ticked as the tech failure', () => {
  assert.ok(checkVisitReason({ reason: 'other', note: 'Left a mess', gobackChecked: true }).error);
  assert.equal(checkVisitReason({ reason: 'other', note: 'Left a mess', gobackChecked: true, gobackTech: T2 }).value.goback_tech, T2);
  assert.equal(checkVisitReason({ reason: 'other', note: 'Left a mess', gobackChecked: false, gobackTech: T2 }).value.goback_tech, null);
});

test('notes are capped at 300 characters', () => {
  assert.equal(checkVisitReason({ reason: 'other', note: 'x'.repeat(500) }).value.reason_note.length, 300);
});

test('reason text for a visit row', () => {
  assert.equal(reasonText({ reason: '' }), '');
  assert.equal(reasonText({}), '');
  assert.equal(reasonText({ reason: 'tech_redo' }), 'Work not up to standard, redo');
  assert.equal(reasonText({ reason: 'other', reason_note: 'Waiting on the adjuster' }), 'Other: Waiting on the adjuster');
  assert.equal(reasonText({ reason: 'other', reason_note: '' }), 'Other');
});

test('the likeliest tech for a go-back: the latest visit that happened', () => {
  const visits = [
    { tech_id: T1, starts_at: '2026-11-10T14:00:00Z', status: 'finished' },
    { tech_id: T2, starts_at: '2026-11-12T14:00:00Z', status: 'scheduled' },
  ];
  assert.equal(defaultGobackTech(visits), T1);
  assert.deepEqual(techsOnJob(visits), [T2, T1]);
  assert.equal(defaultGobackTech([{ tech_id: T2, starts_at: '2026-11-12T14:00:00Z', status: 'scheduled' }]), T2);
  assert.equal(defaultGobackTech([{ tech_id: T1, starts_at: '2026-11-10T14:00:00Z', status: 'cancelled' }]), '');
  assert.equal(defaultGobackTech([{ tech_id: null, starts_at: '2026-11-10T14:00:00Z', status: 'finished' }]), '');
  assert.equal(defaultGobackTech([]), '');
});

test('go-backs per tech, voided ones left out', () => {
  const rows = [{ tech_id: T1 }, { tech_id: T2 }, { tech_id: T1 }, { tech_id: T1, voided_at: '2026-11-01' }];
  assert.deepEqual(gobackCounts(rows), [{ techId: T1, count: 2 }, { techId: T2, count: 1 }]);
  assert.deepEqual(gobackCounts([]), []);
});
