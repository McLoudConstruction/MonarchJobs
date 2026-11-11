import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kindOf, suggestPriority, buildLossSummary, buildServiceRequested, finishLead, needsRestorationReview, intakeHighlights, STEPS,
} from '../lib/leadIntake.js';

test('a lead belongs to the flow its type or job type says', () => {
  assert.equal(kindOf({ restoration_type: 'extraction', job_type: 'floor_cleaning' }), 'restoration');
  assert.equal(kindOf({ job_type: 'water_restoration' }), 'restoration');
  assert.equal(kindOf({ job_type: 'floor_cleaning' }), 'carpet');
  assert.equal(kindOf({ job_type: 'other' }), '');
  assert.equal(kindOf(null), '');
});

test('both flows end on the schedule step', () => {
  assert.equal(STEPS.restoration.at(-1), 'Schedule');
  assert.equal(STEPS.carpet.at(-1), 'Schedule');
  assert.equal(STEPS.restoration.length, 5);
  assert.equal(STEPS.carpet.length, 5);
});

test('priority follows the 24 and 48 hour lines and safety hazards', () => {
  assert.equal(suggestPriority({}), 'standard');
  assert.equal(suggestPriority({ loss_started: 'over48' }), 'standard');
  assert.equal(suggestPriority({ loss_started: '24to48' }), 'urgent');
  assert.equal(suggestPriority({ loss_started: 'under24' }), 'emergency');
  assert.equal(suggestPriority({ loss_started: '24to48', loss_discovered: 'under24' }), 'emergency');
  assert.equal(suggestPriority({ loss_started: 'over48', water_flow: 'running' }), 'emergency');
  assert.equal(suggestPriority({ loss_started: 'over48', electrical: 'hazard_on' }), 'emergency');
  assert.equal(suggestPriority({ loss_started: 'over48', electrical: 'hazard_off' }), 'standard');
  assert.equal(suggestPriority({ loss_started: 'over48', site_hazards: ['Gas smell'] }), 'emergency');
  assert.equal(suggestPriority({ loss_started: 'over48', injuries: 'yes' }), 'emergency');
});

test('the tech summary reads like a short note and leaves out what was not asked', () => {
  const s = buildLossSummary('restoration', 'extraction', {
    loss_type: 'Burst pipe', water_source: 'clean', loss_started: 'under24', affected_rooms: 'Kitchen and hall', affected_sqft: '300',
    materials_wet: ['Carpet and pad', 'Drywall'],
  });
  assert.equal(s, 'Extraction: burst pipe, clean water, under 24 hours old, Kitchen and hall, about 300 sq ft, wet: carpet and pad, drywall');
  assert.equal(buildLossSummary('restoration', 'mitigation', {}), 'Mitigation');
  const c = buildLossSummary('carpet', null, { clean_items: ['Carpet', 'Area rugs'], clean_type: 'deep', area_count: '4', stains: ['Wine'], pet_odor: 'yes' });
  assert.equal(c, 'carpet, area rugs, deep clean, 4 rooms or areas, stains: wine, pet odor');
});

test('the service line is the type and cause, or what is being cleaned', () => {
  assert.equal(buildServiceRequested('restoration', 'remediation', { loss_type: 'Sewage backup' }), 'Remediation · Sewage backup');
  assert.equal(buildServiceRequested('carpet', null, { clean_items: ['Carpet', 'Upholstery'] }), 'Carpet, Upholstery');
  assert.equal(buildServiceRequested('', null, {}), '');
});

test('carpet water or mold answers flag the lead for restoration review', () => {
  assert.equal(needsRestorationReview({ recent_water: 'yes' }), true);
  assert.equal(needsRestorationReview({ mold_smell: 'yes' }), true);
  assert.equal(needsRestorationReview({ recent_water: 'no', mold_smell: 'no' }), false);
  const out = finishLead({ intake: { mold_smell: 'yes', clean_items: ['Carpet'] }, loss_summary: '', service_requested: '' }, 'carpet');
  assert.equal(out.intake.restoration_review, true);
  assert.equal(out.job_type, 'floor_cleaning');
  assert.equal(out.restoration_type, null);
});

test('saving a restoration lead sets job type and priority but keeps what the office typed', () => {
  const out = finishLead({
    restoration_type: 'extraction', priority: null, loss_summary: 'Call before arriving', service_requested: '',
    intake: { loss_type: 'Toilet overflow', loss_started: 'under24' },
  }, 'restoration');
  assert.equal(out.job_type, 'water_restoration');
  assert.equal(out.priority, 'emergency');
  assert.equal(out.loss_summary, 'Call before arriving');
  assert.equal(out.service_requested, 'Extraction · Toilet overflow');
  const chosen = finishLead({ restoration_type: 'mitigation', priority: 'standard', intake: { loss_started: 'under24' } }, 'restoration');
  assert.equal(chosen.priority, 'standard');
});

test('the overview shows only answers that exist', () => {
  assert.deepEqual(intakeHighlights('restoration', { intake: {} }), []);
  const rows = intakeHighlights('restoration', { intake: { loss_type: 'Burst pipe', water_source: 'gray', claim: 'yes', carrier: 'State Farm', claim_number: 'A1' } });
  assert.deepEqual(rows, [['Loss', 'Burst pipe · Gray (dishwasher, washer, sink)'], ['Claim', 'State Farm · claim A1']]);
  const carpet = intakeHighlights('carpet', { intake: { clean_items: ['Carpet'], quote_type: 'phone' } });
  assert.deepEqual(carpet, [['Cleaning', 'Carpet'], ['Quote', 'Quick quote by phone']]);
});
