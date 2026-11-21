import test from 'node:test';
import assert from 'node:assert/strict';
import { CLAIM_CHECKLIST, claimProgress, intakeHighlights } from '../lib/leadIntake.js';

test('the claim checklist only applies when there is a claim', () => {
  assert.equal(claimProgress({}), null);
  assert.equal(claimProgress({ claim: 'no' }), null);
  assert.equal(claimProgress({ claim: 'unsure' }), null);
  const p = claimProgress({ claim: 'yes' });
  assert.equal(p.done, 0);
  assert.equal(p.total, CLAIM_CHECKLIST.length);
  assert.equal(p.missing.length, CLAIM_CHECKLIST.length);
});

test('ticked items count; unknown keys do not', () => {
  const p = claimProgress({ claim: 'yes', claim_checks: ['claim_number', 'deductible', 'not_a_real_key'] });
  assert.equal(p.done, 2);
  assert.ok(!p.missing.some((m) => /Claim number|Deductible/.test(m)));
  assert.equal(claimProgress({ claim: 'yes', claim_checks: CLAIM_CHECKLIST.map((o) => o.value) }).missing.length, 0);
});

test('the lead overview shows how far the checklist is', () => {
  const rows = intakeHighlights('restoration', { intake: { claim: 'yes', carrier: 'State Farm', claim_checks: ['claim_number', 'adjuster'] } });
  const row = rows.find(([l]) => l === 'Claim checklist');
  assert.ok(row);
  assert.match(row[1], /^2 of 8 asked \(still open: /);
  const full = intakeHighlights('restoration', { intake: { claim: 'yes', claim_checks: CLAIM_CHECKLIST.map((o) => o.value) } });
  assert.equal(full.find(([l]) => l === 'Claim checklist')[1], '8 of 8 asked');
  assert.equal(intakeHighlights('restoration', { intake: { claim: 'no' } }).find(([l]) => l === 'Claim checklist'), undefined);
});

test('every checklist item has a unique key and some words', () => {
  assert.equal(new Set(CLAIM_CHECKLIST.map((o) => o.value)).size, CLAIM_CHECKLIST.length);
  for (const o of CLAIM_CHECKLIST) assert.ok(o.label.length > 8);
});
