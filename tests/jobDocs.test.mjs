import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UUID_RE, isUuid, photoPaths, countByKind, filterPhotos, takenAtFor, fitWithin, eventLabel,
  buildUpdateMessages, updateRecipients, PHOTO_KIND_KEYS,
} from '../lib/jobDocs.js';

const J = '3f2b8c1e-5d4a-4b3c-9a8e-1234567890ab';
const P = '0a1b2c3d-1111-4222-8333-444455556666';

test('uuid check is strict', () => {
  assert.ok(isUuid(J));
  for (const bad of ['', 'x', J + 'a', `${J}/..`, null, 5]) assert.ok(!isUuid(bad), String(bad));
  assert.ok(UUID_RE.test(P));
});

test('photo file paths match what the database insert policy requires', () => {
  assert.deepEqual(photoPaths(J, P), { full: `${J}/${P}.jpg`, thumb: `${J}/${P}_t.jpg` });
});

test('fitWithin shrinks to the longest side and never enlarges', () => {
  assert.deepEqual(fitWithin(4000, 3000, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(fitWithin(3000, 4000, 2000), { width: 1500, height: 2000 });
  assert.deepEqual(fitWithin(800, 600, 2000), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(1, 5000, 400), { width: 1, height: 400 });
});

test('counts and filters leave archived photos out of the live views', () => {
  const photos = [
    { id: 1, kind: 'before' }, { id: 2, kind: 'before' }, { id: 3, kind: 'after' },
    { id: 4, kind: 'damage', archived_at: '2026-11-01' }, { id: 5, kind: 'during', room_key: 'r1' },
  ];
  const c = countByKind(photos);
  assert.equal(c.all, 4);
  assert.equal(c.before, 2);
  assert.equal(c.damage, 0);
  assert.deepEqual(PHOTO_KIND_KEYS, ['before', 'during', 'after', 'damage', 'other']);
  assert.deepEqual(filterPhotos(photos, { kind: 'before' }).map((p) => p.id), [1, 2]);
  assert.deepEqual(filterPhotos(photos, { archived: true }).map((p) => p.id), [4]);
  assert.deepEqual(filterPhotos(photos, { roomKey: 'r1' }).map((p) => p.id), [5]);
});

test('takenAtFor trusts a sensible file date and falls back to now otherwise', () => {
  const now = Date.parse('2026-11-10T16:00:00Z');
  assert.equal(takenAtFor(Date.parse('2026-11-10T15:00:00Z'), now), '2026-11-10T15:00:00.000Z');
  for (const bad of [0, NaN, undefined, now + 3600e3, now - 11 * 365 * 24 * 3600e3]) {
    assert.equal(takenAtFor(bad, now), new Date(now).toISOString(), String(bad));
  }
});

test('history wording for the new events, and the old look for the rest', () => {
  assert.equal(eventLabel({ kind: 'photos_added', details: { count: 3, kind: 'before' } }), 'added 3 photos (Before)');
  assert.equal(eventLabel({ kind: 'photos_added', details: { count: 1 } }), 'added 1 photo');
  assert.equal(eventLabel({ kind: 'sketch_created', details: { name: 'Main floor' } }), 'started sketch "Main floor"');
  assert.equal(eventLabel({ kind: 'update_posted', details: { category: 'Safety' } }), 'posted an internal update (Safety)');
  assert.equal(eventLabel({ kind: 'progress_update_sent', details: { manual: true } }), 'marked a progress update as sent');
  assert.equal(eventLabel({ kind: 'visit_cancelled' }), 'visit cancelled');
  assert.equal(eventLabel({ kind: 'status', details: {} }), 'status');
});

test('update messages carry the link, the business and the job number; html is escaped', () => {
  const m = buildUpdateMessages({ business: 'Fresh <Floors> & Co', customerName: 'Dana Smith', link: 'https://x.test/u/abc?a=1&b=2', jobNumber: 1042 });
  assert.match(m.sms, /^Hi Dana, here is a progress update on job #1042 from Fresh <Floors> & Co: https:\/\/x\.test\/u\/abc/);
  assert.match(m.subject, /job #1042/);
  assert.ok(m.html.includes('Fresh &lt;Floors&gt; &amp; Co'));
  assert.ok(m.html.includes('a=1&amp;b=2'));
  assert.ok(!m.html.includes('<Floors>'));
  const bare = buildUpdateMessages({ business: '', customerName: '', link: 'https://x.test/u/abc' });
  assert.match(bare.sms, /^Hi, here is a progress update from us: /);
});

test('recipients: customer plus extra contacts, each person once, unusable ones dropped', () => {
  const out = updateRecipients(
    { display_name: 'Dana Smith', phone: '(417) 555-0100', email: 'dana@example.com' },
    [
      { name: 'Dana again', phone: '417-555-0100', email: 'DANA@example.com' },     // same person on a second record
      { name: 'Adjuster', phone: '', email: 'adj@ins.example' },
      { name: 'Landlord', phone: '555-12', email: 'not-an-email' },                    // nothing usable
      { name: 'Spouse', phone: '+1 417 555 0199', email: '' },
    ],
  );
  assert.deepEqual(out.map((r) => r.name), ['Dana Smith', 'Adjuster', 'Spouse']);
  assert.equal(out[0].phone, '(417) 555-0100');
  assert.equal(out[1].phone, '');
  assert.equal(updateRecipients(null, []).length, 0);
});
