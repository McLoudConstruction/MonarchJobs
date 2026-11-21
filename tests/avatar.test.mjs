import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarPathFor, avatarBelongsTo, checkAvatarUpload, squareCrop, AVATAR_MAX_BYTES } from '../lib/avatar.js';

const S = '11111111-1111-4111-8111-111111111111';
const U = '22222222-2222-4222-8222-222222222222';

test('a profile picture lives in its owner’s folder only', () => {
  const p = avatarPathFor(S, U);
  assert.equal(p, `${S}/${U}.jpg`);
  assert.equal(avatarBelongsTo(p, S), true);
  assert.equal(avatarBelongsTo(p, '33333333-3333-4333-8333-333333333333'), false);
  assert.equal(avatarBelongsTo(`${S}/../x.jpg`, S), false);
  assert.equal(avatarBelongsTo(null, S), false);
});

test('uploads are checked for presence, type and size', () => {
  assert.match(checkAvatarUpload({ size: 0, type: 'image/jpeg' }), /did not come through/);
  assert.match(checkAvatarUpload({ size: 100, type: 'application/pdf' }), /JPEG, PNG or WebP/);
  assert.match(checkAvatarUpload({ size: AVATAR_MAX_BYTES + 1, type: 'image/png' }), /too large/);
  assert.equal(checkAvatarUpload({ size: 20000, type: 'image/webp' }), null);
});

test('the square crop takes the middle of the picture', () => {
  assert.deepEqual(squareCrop(400, 300), { sx: 50, sy: 0, side: 300 });
  assert.deepEqual(squareCrop(300, 400), { sx: 0, sy: 50, side: 300 });
  assert.deepEqual(squareCrop(200, 200), { sx: 0, sy: 0, side: 200 });
  assert.equal(squareCrop(0, 0).side, 1);
});
