import test from 'node:test';
import assert from 'node:assert/strict';
import { streetKey, houseNumber, sameStreet, planStreetOffers, buildStreetOfferMessages, streetDedupe } from '../lib/streetOffers.js';

test('street names compare without number, unit, punctuation or abbreviations', () => {
  assert.equal(streetKey('1204 N. Maple St., Apt 3'), 'north maple street');
  assert.equal(streetKey('88 north maple street'), 'north maple street');
  assert.equal(streetKey('12 Oak Ave'), 'oak avenue');
  assert.equal(streetKey('12 St Louis Rd'), 'st louis road');
  assert.equal(streetKey('500'), '');
  assert.equal(houseNumber('1204 N Maple'), 1204);
  assert.equal(houseNumber('Maple'), null);
});

test('same street needs the same city too', () => {
  assert.ok(sameStreet({ street: '10 Oak St', city: 'Joplin' }, { street: '244 oak street', city: 'joplin' }));
  assert.ok(!sameStreet({ street: '10 Oak St', city: 'Joplin' }, { street: '10 Oak St', city: 'Carthage' }));
  assert.ok(!sameStreet({ street: '', city: 'Joplin' }, { street: '', city: 'Joplin' }));
});

const job = { customer_id: 'me', address: { street: '100 Oak St', city: 'Joplin' } };
const cand = (id, over = {}) => ({ customer_id: id, display_name: id, first_name: id, phone: '4175550100', email: '', opt_out: false, has_open_work: false,
  last_visit_at: '2025-01-01T12:00:00Z', address: { street: '120 Oak Street', city: 'Joplin' }, last_job: { id: `j${id}`, token: `t${id}` }, ...over });
const now = new Date('2026-11-22T18:00:00Z');

test('plan keeps neighbors, nearest house first, and says why others are skipped', () => {
  const r = planStreetOffers({
    now, job, settings: { street_offer_max: 10, street_offer_quiet_days: 60 },
    candidates: [
      cand('far', { address: { street: '900 Oak St', city: 'Joplin' } }),
      cand('near', { address: { street: '102 Oak St', city: 'Joplin' } }),
      cand('me'), // the finished job's own customer
      cand('elsewhere', { address: { street: '5 Elm St', city: 'Joplin' } }),
      cand('stop', { opt_out: true }), cand('nocontact', { phone: '', email: '' }), cand('open', { has_open_work: true }),
      cand('fresh', { last_visit_at: '2026-11-10T12:00:00Z' }),
    ],
  });
  assert.deepEqual(r.eligible.map((c) => c.customer_id), ['near', 'far']);
  assert.deepEqual(r.skipped.map((s) => s.reason).sort(), ['no_contact', 'open_work', 'opted_out', 'recent']);
});

test('nobody is messaged twice in a day or offered twice for one job', () => {
  const r = planStreetOffers({
    now, job, blocked: ['p:4175550100'], offered: ['b'],
    candidates: [cand('a'), cand('b', { phone: '4175550111' }), cand('c', { phone: '4175550122', email: 'x@y.com' })],
  });
  assert.deepEqual(r.eligible.map((c) => c.customer_id), ['c']);
  assert.deepEqual(r.skipped.map((s) => s.reason).sort(), ['messaged_today', 'offered']);
});

test('batch is capped and overflow reported', () => {
  const many = Array.from({ length: 7 }, (_, i) => cand(`c${i}`, { phone: `41755501${10 + i}` }));
  const r = planStreetOffers({ now, job, candidates: many, settings: { street_offer_max: 3 } });
  assert.equal(r.eligible.length, 3);
  assert.equal(r.overflow, 4);
});

test('message is calm, ends with STOP, and names neither staff nor the other customer nor the street', () => {
  const m = buildStreetOfferMessages({ business: 'Acme Floors', offer: 'Neighbors get 10% off.', firstName: 'Pat', link: 'https://x.com/c/abc' });
  assert.match(m.sms, /^Hi Pat, Acme Floors just finished a job in your neighborhood\. Neighbors get 10% off\. Request a time here: https:\/\/x\.com\/c\/abc Reply STOP to opt out\.$/);
  assert.match(m.text, /Stop reminders/);
  assert.doesNotMatch(m.sms, /Oak/);
  assert.match(buildStreetOfferMessages({ business: '', firstName: '', link: 'L' }).sms, /^Hi there, we just/);
  assert.equal(streetDedupe('J1'), 'street:J1');
});
