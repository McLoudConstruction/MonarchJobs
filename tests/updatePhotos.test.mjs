import test from 'node:test';
import assert from 'node:assert/strict';
import { photosStillMissing, sendBlockedText, waitingPhotosText } from '../lib/updatePhotos.js';

test('an update is only ready when every photo it names is on the job', () => {
  assert.deepEqual(photosStillMissing(['a', 'b', 'c'], ['a', 'c']), ['b']);
  assert.deepEqual(photosStillMissing(['a'], new Set(['a'])), []);
  assert.deepEqual(photosStillMissing([], ['a']), []);
  assert.deepEqual(photosStillMissing(null, ['a']), []);
  assert.deepEqual(photosStillMissing(['x', 'y'], []), ['x', 'y']);
});

test('the wording says how many are still uploading', () => {
  assert.equal(waitingPhotosText(1), '1 photo is still uploading');
  assert.equal(waitingPhotosText(3), '3 photos are still uploading');
  assert.match(sendBlockedText(['a']), /1 photo is still uploading/);
  assert.match(sendBlockedText(['a', 'b']), /as soon as they have arrived/);
});
