import test from 'node:test';
import assert from 'node:assert/strict';
import { readingPhotoKey } from '../lib/moisture.js';
import { roomPhotoCounts } from '../lib/sketch.js';

test('meter photos are counted under the reading key, apart from room photos', () => {
  const photos = [
    { sketch_id: 's1', room_key: readingPhotoKey('abc') },
    { sketch_id: 's1', room_key: readingPhotoKey('abc') },
    { sketch_id: 's1', room_key: 'room1' },
    { sketch_id: 's2', room_key: readingPhotoKey('abc') },
    { sketch_id: 's1', room_key: readingPhotoKey('abc'), archived_at: '2026-11-01' },
  ];
  const c = roomPhotoCounts(photos, 's1');
  assert.equal(c[readingPhotoKey('abc')], 2);
  assert.equal(c.room1, 1);
});
