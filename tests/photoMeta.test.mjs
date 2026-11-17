import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanTag, cleanTags, addTag, removeTag, tagCounts, gpsFromPosition, freshGps, mapsUrl, sha256Hex, knownHashes,
  shouldKeepOriginal, photoRoomValue, splitRoomValue, mergeWaiting, localStatus, filterGrid, roomCounts, MAX_TAGS, MAX_TAG_LEN,
} from '../lib/photoMeta.js';

test('tags are trimmed, de-duplicated without regard to case, and limited', () => {
  assert.equal(cleanTag('  #Hail   damage, '), 'Hail damage');
  assert.equal(cleanTag('x'.repeat(80)).length, MAX_TAG_LEN);
  assert.deepEqual(cleanTags(['Water', 'water', ' ', 'Mold', 'WATER ']), ['Water', 'Mold']);
  assert.equal(cleanTags(Array.from({ length: 50 }, (_, i) => `t${i}`)).length, MAX_TAGS);
  assert.deepEqual(cleanTags(null), []);
  assert.deepEqual(addTag(['Water'], 'water'), ['Water']);
  assert.deepEqual(addTag(['Water'], 'Mold'), ['Water', 'Mold']);
  assert.deepEqual(removeTag(['Water', 'Mold'], 'water'), ['Mold']);
});

test('tag counts skip archived photos and sort by use', () => {
  const photos = [
    { tags: ['Water'] }, { tags: ['water', 'Mold'] }, { tags: ['Mold'], archived_at: '2026-11-01' }, { tags: [] }, {},
  ];
  assert.deepEqual(tagCounts(photos), [{ tag: 'Water', count: 2 }, { tag: 'Mold', count: 1 }]);
});

test('a browser position becomes a rounded fix, and nonsense is refused', () => {
  const ok = gpsFromPosition({ coords: { latitude: 39.12345678, longitude: -94.56789012, accuracy: 12.345 }, timestamp: 1000 });
  assert.deepEqual(ok, { lat: 39.123457, lng: -94.56789, accuracy: 12.3, at: 1000 });
  assert.equal(gpsFromPosition(null), null);
  assert.equal(gpsFromPosition({ coords: { latitude: 'x', longitude: 1 } }), null);
  assert.equal(gpsFromPosition({ coords: { latitude: 95, longitude: 1 } }), null);
  assert.equal(gpsFromPosition({ coords: { latitude: 0, longitude: 0, accuracy: 5 } }), null, 'no real fix');
  assert.equal(gpsFromPosition({ coords: { latitude: 10, longitude: 20 } }).accuracy, null);
});

test('a location fix expires', () => {
  const fix = { lat: 1, lng: 2, accuracy: 9, at: 1_000_000 };
  assert.deepEqual(freshGps(fix, 1_000_000 + 60_000), { lat: 1, lng: 2, accuracy: 9 });
  assert.equal(freshGps(fix, 1_000_000 + 10 * 60_000), null);
  assert.equal(freshGps(null), null);
  assert.match(mapsUrl(39.1, -94.5), /^https:\/\/www\.google\.com\/maps\?q=39\.1%2C-94\.5$/);
});

test('the same bytes give the same sha-256, different bytes do not', async () => {
  const a = await sha256Hex(new Blob([new Uint8Array([1, 2, 3])]));
  const b = await sha256Hex(new Uint8Array([1, 2, 3]).buffer);
  const c = await sha256Hex(new Blob([new Uint8Array([1, 2, 4])]));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a, '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
});

test('known hashes come from live photos and from pictures waiting on the phone', () => {
  const set = knownHashes(
    [{ content_hash: 'a' }, { content_hash: 'b', archived_at: 'x' }, {}],
    [{ contentHash: 'c', state: 'pending' }, { contentHash: 'd', state: 'cancelled' }],
  );
  assert.deepEqual([...set].sort(), ['a', 'c']);
});

test('a full-size original is kept only when it is on, allowed, small enough and worth it', () => {
  const base = { keep: true, size: 6_000_000, type: 'image/jpeg', webSize: 500_000 };
  assert.equal(shouldKeepOriginal(base), true);
  assert.equal(shouldKeepOriginal({ ...base, keep: false }), false);
  assert.equal(shouldKeepOriginal({ ...base, type: 'image/heic' }), false);
  assert.equal(shouldKeepOriginal({ ...base, size: 20_000_000 }), false);
  assert.equal(shouldKeepOriginal({ ...base, size: 520_000 }), false, 'barely bigger than the web copy');
  assert.equal(shouldKeepOriginal({ ...base, size: 0 }), false);
});

test('room values join and split the sketch id and the room id', () => {
  assert.equal(photoRoomValue({ sketch_id: 's1', room_key: 'r1' }), 's1|r1');
  assert.equal(photoRoomValue({ sketch_id: 's1' }), '');
  assert.deepEqual(splitRoomValue('s1|r1'), { sketchId: 's1', roomKey: 'r1' });
  assert.equal(splitRoomValue(''), null);
  assert.equal(splitRoomValue('s1'), null);
});

test('waiting pictures join the grid unless the server already has them or they were undone', () => {
  const photos = [{ id: 'p1', kind: 'during', taken_at: '2026-11-16T10:00:00Z' }];
  const waiting = [
    { id: 'p1', state: 'pending', kind: 'during', takenAt: 't' },
    { id: 'w1', state: 'pending', kind: 'before', takenAt: '2026-11-16T11:00:00Z', url: 'blob:1', roomKey: 'r1', sketchId: 's1', attempts: 0 },
    { id: 'w2', state: 'cancelled', kind: 'before', takenAt: 't' },
    { id: 'w3', state: 'blocked', kind: 'after', takenAt: 't', lastError: 'nope', attempts: 2 },
  ];
  const all = mergeWaiting(photos, waiting);
  assert.deepEqual(all.map((p) => p.id), ['p1', 'w1', 'w3']);
  assert.equal(all[1]._local, true);
  assert.equal(all[1].thumbUrl, 'blob:1');
  assert.equal(photoRoomValue(all[1]), 's1|r1');
  assert.deepEqual(localStatus(all[1]), { key: 'sending', label: 'Sending' });
  assert.deepEqual(localStatus({ state: 'pending', attempts: 1 }), { key: 'waiting', label: 'Waiting for signal' });
  assert.deepEqual(localStatus(all[2]), { key: 'blocked', label: 'Needs attention' });
});

test('filters combine: folder, room, tag, who and archived', () => {
  const items = [
    { id: 1, kind: 'before', sketch_id: 's', room_key: 'a', tags: ['Water'], created_by: 'u1' },
    { id: 2, kind: 'after', sketch_id: 's', room_key: 'a', tags: [], created_by: 'u2' },
    { id: 3, kind: 'after', tags: ['water'], created_by: 'u1' },
    { id: 4, kind: 'after', tags: [], created_by: 'u1', archived_at: 'x' },
    { id: 5, kind: 'during', _local: true, tags: [], created_by: null },
  ];
  const ids = (o) => filterGrid(items, o).map((p) => p.id);
  assert.deepEqual(ids({}), [1, 2, 3, 5]);
  assert.deepEqual(ids({ kind: 'after' }), [2, 3]);
  assert.deepEqual(ids({ roomValue: 's|a' }), [1, 2]);
  assert.deepEqual(ids({ roomValue: 'none' }), [3, 5]);
  assert.deepEqual(ids({ tag: 'WATER' }), [1, 3]);
  assert.deepEqual(ids({ who: 'u1' }), [1, 3]);
  assert.deepEqual(ids({ who: 'me' }), [5]);
  assert.deepEqual(ids({ archived: true }), [4]);
  assert.deepEqual(ids({ kind: 'after', roomValue: 's|a', who: 'u2' }), [2]);
});

test('room chips count live photos and keep a chip for a room that was removed', () => {
  const rooms = [{ value: 's|a', label: 'Kitchen' }, { value: 's|b', label: 'Hall' }, { value: 's|c', label: 'Den' }];
  const items = [
    { sketch_id: 's', room_key: 'a' }, { sketch_id: 's', room_key: 'a' }, { sketch_id: 's', room_key: 'c' },
    { sketch_id: 's', room_key: 'gone' }, {}, { sketch_id: 's', room_key: 'a', archived_at: 'x' },
  ];
  const r = roomCounts(items, rooms);
  assert.deepEqual(r.rooms, [
    { value: 's|a', label: 'Kitchen', count: 2 }, { value: 's|c', label: 'Den', count: 1 }, { value: 's|gone', label: 'Removed room', count: 1 },
  ]);
  assert.equal(r.none, 1);
});
