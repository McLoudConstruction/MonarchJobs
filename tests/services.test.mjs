import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFeature, serviceOf, tabsFor, noteCategories, areaKindsFor, serviceTitle, JOB_TYPE_FOR_SERVICE, FEATURES, SERVICE_KEYS } from '../lib/services.js';
import { INTERNAL_CATEGORIES } from '../lib/jobDocs.js';
import { fabActions } from '../lib/jobFab.js';

const TABS = [['overview', 'Overview'], ['photos', 'Photos'], ['sketch', 'Sketch'], ['moisture', 'Moisture'], ['inspection', 'Inspection'], ['updates', 'Updates'], ['estimate', 'Estimate']];

test('no service shows everything', () => {
  for (const f of Object.keys(FEATURES)) assert.equal(hasFeature('', f), true, f);
  assert.equal(hasFeature(null, 'moistureTab'), true);
  assert.equal(hasFeature('bogus', 'inspectionTab'), true);
});

test('every feature extraction has, mitigation has too', () => {
  for (const [f, list] of Object.entries(FEATURES)) {
    if (list.includes('extraction')) assert.ok(list.includes('mitigation'), f);
  }
});

test('carpet gets the inspection tab and the customer page, not the drying tools', () => {
  assert.equal(hasFeature('carpet', 'inspectionTab'), true);
  assert.equal(hasFeature('carpet', 'customerPage'), true);
  assert.equal(hasFeature('carpet', 'moistureTab'), false);
  assert.equal(hasFeature('carpet', 'progressUpdates'), false);
  assert.equal(hasFeature('carpet', 'affectedAreas'), false);
  assert.equal(hasFeature('carpet', 'recheck'), false);
});

test('extraction is barebones: no moisture, no inspection, no customer page', () => {
  assert.equal(hasFeature('extraction', 'moistureTab'), false);
  assert.equal(hasFeature('extraction', 'inspectionTab'), false);
  assert.equal(hasFeature('extraction', 'customerPage'), false);
  assert.equal(hasFeature('extraction', 'quoteFromSketch'), true);
  assert.equal(hasFeature('extraction', 'affectedAreas'), true);
});

test('mitigation has the moisture tab, rechecks, progress updates and everything extraction has', () => {
  for (const f of ['moistureTab', 'recheck', 'moveToMoisture', 'progressUpdates', 'affectedAreas', 'quoteFromSketch', 'ceilingHeight']) assert.equal(hasFeature('mitigation', f), true, f);
  assert.equal(hasFeature('mitigation', 'inspectionTab'), false);
  assert.equal(hasFeature('mitigation', 'moldSmoke'), false);
});

test('remediation: sketch, progress updates, mold and smoke; no moisture tab', () => {
  assert.equal(hasFeature('remediation', 'moldSmoke'), true);
  assert.equal(hasFeature('remediation', 'progressUpdates'), true);
  assert.equal(hasFeature('remediation', 'affectedAreas'), true);
  assert.equal(hasFeature('remediation', 'moistureTab'), false);
});

test('tabs follow the service', () => {
  const keys = (s) => tabsFor(TABS, s).map(([k]) => k);
  assert.deepEqual(keys('carpet'), ['overview', 'photos', 'sketch', 'inspection', 'updates', 'estimate']);
  assert.deepEqual(keys('extraction'), ['overview', 'photos', 'sketch', 'updates', 'estimate']);
  assert.deepEqual(keys('mitigation'), ['overview', 'photos', 'sketch', 'moisture', 'updates', 'estimate']);
  assert.deepEqual(keys(''), TABS.map(([k]) => k));
});

test('serviceOf reads a job or a lead', () => {
  assert.equal(serviceOf({ service: 'extraction', job_type: 'water_restoration' }), 'extraction');
  assert.equal(serviceOf({ restoration_type: 'remediation', job_type: 'water_restoration' }), 'remediation');
  assert.equal(serviceOf({ job_type: 'floor_cleaning' }), 'carpet');
  assert.equal(serviceOf({ job_type: 'water_restoration' }), 'mitigation');
  assert.equal(serviceOf({ job_type: 'other' }), '');
  assert.equal(serviceOf(null), '');
});

test('job_type follows the service the way the database trigger does', () => {
  assert.deepEqual(SERVICE_KEYS.map((k) => JOB_TYPE_FOR_SERVICE[k]), ['floor_cleaning', 'water_restoration', 'water_restoration', 'water_restoration']);
});

test('note categories: moisture and equipment only for mitigation, insurance only for restoration', () => {
  assert.ok(noteCategories(INTERNAL_CATEGORIES, 'mitigation').includes('Moisture / drying'));
  assert.ok(!noteCategories(INTERNAL_CATEGORIES, 'carpet').includes('Moisture / drying'));
  assert.ok(!noteCategories(INTERNAL_CATEGORIES, 'carpet').includes('Equipment'));
  assert.ok(!noteCategories(INTERNAL_CATEGORIES, 'carpet').includes('Insurance / adjuster'));
  assert.ok(noteCategories(INTERNAL_CATEGORIES, 'extraction').includes('Insurance / adjuster'));
  assert.ok(!noteCategories(INTERNAL_CATEGORIES, 'extraction').includes('Equipment'));
  assert.ok(noteCategories(INTERNAL_CATEGORIES, 'carpet').includes('General'));
});

test('a note already saved in a hidden category keeps it', () => {
  assert.ok(noteCategories(INTERNAL_CATEGORIES, 'carpet', 'Moisture / drying').includes('Moisture / drying'));
});

test('area tool kinds', () => {
  const order = ['water', 'source', 'growth', 'smoke'];
  assert.deepEqual(areaKindsFor('carpet', order), []);
  assert.deepEqual(areaKindsFor('mitigation', order), ['water', 'source']);
  assert.deepEqual(areaKindsFor('extraction', order), ['water', 'source']);
  assert.deepEqual(areaKindsFor('remediation', order), order);
  assert.deepEqual(areaKindsFor('', order), order);
});

test('titles', () => {
  assert.equal(serviceTitle('carpet'), 'Carpet');
  assert.equal(serviceTitle('extraction'), 'Restoration · Extraction');
  assert.equal(serviceTitle(''), '');
});

test('the phone action button offers Start Recheck only when the service has it', () => {
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: null, recheck: false }), ['photos', 'internal']);
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: 'scheduled', recheck: false }), ['photos', 'otw', 'start', 'internal']);
  assert.deepEqual(fabActions({ hasSketch: true, visitStatus: null }), ['photos', 'recheck', 'internal']);
});

import { ASSET_TYPES, ASSET_ORDER, OTHER_GEAR, typeLabel, cleanAssetForm, cleanEquipmentNote, openIssues } from '../lib/assets.js';
import { EQUIPMENT_TYPES } from '../lib/equipment.js';

test('carpet gear is an asset type but not a sketch placement chip', () => {
  for (const k of Object.keys(OTHER_GEAR)) {
    assert.ok(ASSET_TYPES[k] && ASSET_ORDER.includes(k));
    assert.equal(EQUIPMENT_TYPES[k], undefined);
  }
  assert.equal(typeLabel('truckmount'), 'Truck-mount');
  assert.ok(cleanAssetForm({ type: 'truckmount' }).value);
  assert.ok(cleanAssetForm({ type: 'nope' }).error);
});

test('equipment notes: needs text, only damage and not-working count as open issues', () => {
  assert.ok(cleanEquipmentNote({ kind: 'damage', note: '  ' }).error);
  assert.equal(cleanEquipmentNote({ kind: 'weird', note: 'x' }).value.kind, 'note');
  const n = [{ kind: 'damage' }, { kind: 'note' }, { kind: 'not_working', resolved_at: 'x' }, { kind: 'not_working' }];
  assert.equal(openIssues(n).length, 2);
});

test('the eval sheet is a carpet-only tab', () => {
  const tabs = [['overview', 'Overview'], ['inspection', 'Inspection'], ['evalsheet', 'Eval sheet']];
  assert.equal(hasFeature('carpet', 'evalSheet'), true);
  for (const svc of ['extraction', 'mitigation', 'remediation']) {
    assert.equal(hasFeature(svc, 'evalSheet'), false, svc);
    assert.ok(!tabsFor(tabs, svc).some(([k]) => k === 'evalsheet'), svc);
  }
  assert.ok(tabsFor(tabs, 'carpet').some(([k]) => k === 'evalsheet'));
  assert.ok(tabsFor(tabs, '').some(([k]) => k === 'evalsheet')); // no service shows everything
});
