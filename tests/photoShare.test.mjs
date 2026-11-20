import test from 'node:test';
import assert from 'node:assert/strict';
import { addPhotosToUpdate, addToUpdateText, sharablePhotoIds, expiryFromDays, shareState, shareUrl, publicPhoto, SHARE_MAX_PHOTOS } from '../lib/photoShare.js';
import { photoVoicePath, hasVoice } from '../lib/photoVoice.js';
import { eventLabel } from '../lib/jobDocs.js';

test('adding photos to an update keeps order, skips repeats and stops at the limit', () => {
  const r = addPhotosToUpdate(['a', 'b'], ['b', 'c', 'd']);
  assert.deepEqual(r.ids, ['a', 'b', 'c', 'd']);
  assert.equal(r.added, 2); assert.equal(r.skipped, 1); assert.equal(r.full, 0);
  const full = addPhotosToUpdate(['a', 'b'], ['c', 'd', 'e'], 3);
  assert.deepEqual(full.ids, ['a', 'b', 'c']);
  assert.equal(full.full, 2);
  assert.match(addToUpdateText(full, 3), /Added 1 photo to the update\..*2 did not fit: an update holds 3 photos/);
  assert.match(addToUpdateText({ added: 0, skipped: 2, full: 0 }), /Nothing new.*2 were already/);
  assert.deepEqual(addPhotosToUpdate(null, null).ids, []);
});

test('only finished, unarchived job photos can be shared, capped', () => {
  const photos = [{ id: 'a' }, { id: 'b', archived_at: 'x' }, { id: 'c', _local: true }, { id: 'd' }];
  assert.deepEqual(sharablePhotoIds(['d', 'a', 'a', 'b', 'c', 'zzz'], photos), ['d', 'a']);
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `p${i}` }));
  assert.equal(sharablePhotoIds(many.map((p) => p.id), many).length, SHARE_MAX_PHOTOS);
});

test('a share link is live until it is switched off or runs out', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  assert.equal(shareState({ expires_at: expiryFromDays(30, now), revoked_at: null }, now), 'live');
  assert.equal(shareState({ expires_at: expiryFromDays(30, now), revoked_at: 'x' }, now), 'off');
  assert.equal(shareState({ expires_at: expiryFromDays(7, now) , revoked_at: null }, now + 8 * 86400000), 'expired');
  assert.equal(shareState(null), 'off');
  assert.equal(shareUrl('https://x.com/', 'tok'), 'https://x.com/p/tok');
});

test('a customer sees the picture and, if allowed, its caption: nothing else', () => {
  const row = { id: 'a', caption: 'Dry now', taken_at: '2026-11-18T09:00:00Z', gps_lat: 1, gps_lng: 2, tags: ['mold'], created_by: 'tech1', voice_path: 'j/a_v.webm', storage_path: 's', thumb_path: 't' };
  const on = publicPhoto(row, { showCaptions: true, url: 'U', thumbUrl: 'T' });
  assert.deepEqual(Object.keys(on).sort(), ['caption', 'id', 'taken_on', 'thumb_url', 'url']);
  assert.equal(on.caption, 'Dry now');
  assert.equal(on.taken_on, '2026-11-18');
  assert.equal(publicPhoto(row, { showCaptions: false, url: 'U' }).caption, '');
  assert.equal(publicPhoto(row, { showCaptions: true, url: 'U' }).thumb_url, 'U');
  assert.ok(!JSON.stringify(on).includes('tech1') && !JSON.stringify(on).includes('gps'));
});

test('voice caption paths stay in the job folder; log lines read plainly', () => {
  assert.equal(photoVoicePath('J', 'P', 'webm'), 'J/P_v.webm');
  assert.equal(photoVoicePath('J', 'P', '../x'), 'J/P_v.x');
  assert.equal(hasVoice({ voice_path: 'x' }), true);
  assert.equal(hasVoice({}), false);
  assert.match(eventLabel({ kind: 'photo_link_made', details: { count: 3 } }), /customer photo link \(3 photos\)/);
  assert.match(eventLabel({ kind: 'photos_added_to_update', details: { count: 1 } }), /1 photo to a draft update/);
  assert.match(eventLabel({ kind: 'photo_voice', details: { action: 'removed' } }), /removed a voice caption/);
});
