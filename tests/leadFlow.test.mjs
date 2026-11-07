import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateSnapshot, sameSnapshot } from '../lib/estimate.js';
import { fmtDuration, leadDisplayName } from '../lib/format.js';

test('duration reads naturally', () => {
  assert.equal(fmtDuration(30), '30 min');
  assert.equal(fmtDuration(60), '1 hr');
  assert.equal(fmtDuration(90), '1 hr 30 min');
  assert.equal(fmtDuration(480), '8 hr');
  assert.equal(fmtDuration(0), '');
});

test('lead display name prefers company, then first and last, then the old name', () => {
  assert.equal(leadDisplayName({ company_name: 'Acme', first_name: 'A', last_name: 'B' }), 'Acme');
  assert.equal(leadDisplayName({ first_name: 'Sam', last_name: 'Rivera' }), 'Sam Rivera');
  assert.equal(leadDisplayName({ name: 'Old Name' }), 'Old Name');
  assert.equal(leadDisplayName(null), '');
});

test('snapshot comparison notices any change a customer would care about', () => {
  const lines = [
    { description: 'Extraction', unit: 'sqft', quantity: '100.000', unit_price: '2.50', sort_order: 1, created_at: '2026-11-01' },
    { description: 'Deodorize', unit: 'flat', quantity: 1, unit_price: 40, sort_order: 0, created_at: '2026-11-02' },
  ];
  const snap = estimateSnapshot(lines, '150.00');
  assert.deepEqual(snap.lines.map((l) => l.description), ['Deodorize', 'Extraction']);
  assert.equal(snap.lines[1].quantity, 100);
  // same content from the database (strings vs numbers, other order of keys) still matches
  assert.equal(sameSnapshot(snap, estimateSnapshot([...lines].reverse(), 150)), true);
  assert.equal(sameSnapshot(snap, estimateSnapshot(lines, 100)), false);
  assert.equal(sameSnapshot(snap, estimateSnapshot(lines.slice(1), 150)), false);
  assert.equal(sameSnapshot(snap, estimateSnapshot([{ ...lines[0], unit_price: 3 }, lines[1]], 150)), false);
});

import { buildEstimateMessages } from '../lib/estimateMessages.js';

test('estimate message is short, uses the first name and carries only the link', () => {
  const m = buildEstimateMessages({ business: 'Acme Floors', customerName: 'Sam Rivera', link: 'https://x.test/e/abc' });
  assert.equal(m.sms, 'Hi Sam, your estimate from Acme Floors is ready to view and approve: https://x.test/e/abc');
  assert.ok(m.sms.length < 160);
  assert.equal(m.subject, 'Your estimate from Acme Floors');
  assert.ok(m.html.includes('href="https://x.test/e/abc"'));
  assert.ok(m.text.includes('https://x.test/e/abc'));
  const again = buildEstimateMessages({ business: 'Acme Floors', customerName: '', link: 'https://x.test/e/abc', resend: true });
  assert.equal(again.sms, 'Hi, here is your estimate from Acme Floors again, ready to view and approve: https://x.test/e/abc');
});

test('estimate email escapes names so a customer or business name cannot inject markup', () => {
  const m = buildEstimateMessages({ business: '<b>Evil</b> & Co', customerName: '<script>x</script> Bob', link: 'https://x.test/e/a"b' });
  assert.ok(!m.html.includes('<script>'));
  assert.ok(!m.html.includes('<b>Evil'));
  assert.ok(m.html.includes('&lt;b&gt;Evil&lt;/b&gt; &amp; Co'));
  assert.ok(m.html.includes('a&quot;b'));
});

import { parseAddressComponents, simplifySuggestions, validSessionToken } from '../lib/places.js';

test('Google address components become street, city, state and ZIP', () => {
  const comps = [
    { longText: '123', types: ['street_number'] },
    { longText: 'Main Street', types: ['route'] },
    { longText: 'Springfield', types: ['locality', 'political'] },
    { longText: 'Missouri', shortText: 'MO', types: ['administrative_area_level_1'] },
    { longText: '65802', types: ['postal_code'] },
  ];
  assert.deepEqual(parseAddressComponents(comps), { street: '123 Main Street', city: 'Springfield', state: 'MO', zip: '65802' });
  assert.deepEqual(parseAddressComponents(undefined), { street: '', city: '', state: '', zip: '' });
});

test('suggestions are trimmed to what the list shows', () => {
  const out = simplifySuggestions({ suggestions: [
    { placePrediction: { placeId: 'abc1234567', structuredFormat: { mainText: { text: '123 Main St' }, secondaryText: { text: 'Springfield, MO, USA' } } } },
    { queryPrediction: { text: { text: 'x' } } },
  ] });
  assert.deepEqual(out, [{ placeId: 'abc1234567', main: '123 Main St', secondary: 'Springfield, MO, USA' }]);
  assert.deepEqual(simplifySuggestions(null), []);
});

test('session tokens are limited to safe characters', () => {
  assert.equal(validSessionToken('3f2c9a10-1b2c-4d5e-8f90-123456789abc'), true);
  assert.equal(validSessionToken('bad token&x=1'), false);
  assert.equal(validSessionToken(undefined), false);
});
