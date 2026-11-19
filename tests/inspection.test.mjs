import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blankRoom, blankIssue, cleanInspection, seedPostFromPre, missingBeforeSigning, summarize, roomsFromPlan, latestSigned, inspectionPhotoIds,
} from '../lib/inspection.js';

test('rooms start from the sketch, skipping hard floors', () => {
  const plan = { rooms: [{ id: 'a', label: 'Living room', floor: 'carpet' }, { id: 'b', label: 'Kitchen', floor: 'tile' }, { id: 'c', label: '' }] };
  const rooms = roomsFromPlan(plan);
  assert.equal(rooms.length, 2);
  assert.equal(rooms[0].name, 'Living room');
});

test('stored data is cleaned for the kind', () => {
  const messy = { rooms: [{ id: 'x', name: '  Den ', fiber: 'Velvet', pretest: 'weird', traffic: 1, issues: [{ type: 'Wine', where: 'by door', result: 'removed' }] }], notes: 'n', drying_hours: '6' };
  const pre = cleanInspection('pre', messy);
  assert.equal(pre.rooms[0].name, 'Den');
  assert.equal(pre.rooms[0].fiber, '');
  assert.equal(pre.rooms[0].pretest, 'not_tested');
  assert.equal(pre.rooms[0].issues[0].type, 'Other');
  assert.equal('result' in pre.rooms[0].issues[0], false, 'results belong to the after form');
  assert.equal('drying_hours' in pre, false);
  const post = cleanInspection('post', messy);
  assert.equal(post.rooms[0].issues[0].result, 'removed');
  assert.equal(post.drying_hours, 6);
  assert.equal(cleanInspection('post', { drying_hours: 500 }).drying_hours, null);
  assert.deepEqual(cleanInspection('pre', null).rooms, []);
});

test('the after form starts from the before form with blank results', () => {
  const room = { ...blankRoom('Den'), issues: [{ ...blankIssue(), where: 'door', type: 'Pet urine' }] };
  const post = seedPostFromPre({ rooms: [room], notes: 'old', drying_hours: 4 });
  assert.equal(post.rooms[0].name, 'Den');
  assert.equal(post.rooms[0].issues[0].type, 'Pet urine');
  assert.equal(post.rooms[0].issues[0].result, '');
  assert.equal(post.walkthrough, false);
});

test('what is missing before signing', () => {
  assert.deepEqual(missingBeforeSigning('pre', { rooms: [] }), ['Enter how many rooms.']);
  assert.deepEqual(missingBeforeSigning('pre', { rooms: [blankRoom('Den')] }), []); // an older record: its one room is the count
  assert.deepEqual(missingBeforeSigning('pre', { room_count: 4 }), []);              // the simple record: a count, no rooms called out
  assert.deepEqual(missingBeforeSigning('pre', { room_count: 4, rooms: [blankRoom('')] }), ['Give every called-out room a name.']);
  const room = { ...blankRoom('Den'), issues: [blankIssue()] };
  const m = missingBeforeSigning('post', { rooms: [room] });
  assert.equal(m.length, 2);
  const ok = missingBeforeSigning('post', { rooms: [{ ...room, issues: [{ ...room.issues[0], result: 'removed' }] }], walkthrough: true });
  assert.deepEqual(ok, []);
});

test('the summary counts what was not removed', () => {
  const room = { ...blankRoom('Den'), issues: [{ ...blankIssue(), result: 'removed' }, { ...blankIssue(), result: 'permanent' }] };
  const s = summarize('post', { rooms: [room], drying_hours: 6 });
  assert.equal(s.notRemoved, 1);
  assert.match(s.text, /1 not removed/);
  assert.match(s.text, /6 hours/);
  assert.match(summarize('pre', { rooms: [room] }).text, /2 spots noted/);
});

test('the latest signed record is found', () => {
  const list = [{ kind: 'post', signed_at: '2026-11-01T00:00:00Z', id: 'a' }, { kind: 'post', signed_at: '2026-11-03T00:00:00Z', id: 'b' }, { kind: 'pre', signed_at: null, id: 'c' }];
  assert.equal(latestSigned(list, 'post').id, 'b');
  assert.equal(latestSigned(list, 'pre'), null);
});

test('rooms keep the pictures taken during the walkthrough, clean and capped; a new after-record starts without them', async () => {
  const { cleanInspection, seedPostFromPre, blankRoom } = await import('../lib/inspection.js');
  const d = cleanInspection('pre', { rooms: [{ id: 'r1', name: 'Den', photo_ids: ['a', 'a', '', 'b', 5] }] });
  assert.deepEqual(d.rooms[0].photo_ids, ['a', 'b', '5']);
  assert.deepEqual(cleanInspection('pre', { rooms: [{ name: 'X' }] }).rooms[0].photo_ids, []);
  assert.equal(cleanInspection('pre', { rooms: [{ name: 'X', photo_ids: Array.from({ length: 50 }, (_, i) => `p${i}`) }] }).rooms[0].photo_ids.length, 30);
  assert.deepEqual(seedPostFromPre(d).rooms[0].photo_ids, []);
  assert.deepEqual(blankRoom().photo_ids, []);
});

test('the simple record: a room count and photos, no rooms called out', () => {
  const d = cleanInspection('pre', { room_count: '5', photo_ids: ['p1', 'p2', 'p1', ''] });
  assert.equal(d.room_count, 5);
  assert.deepEqual(d.photo_ids, ['p1', 'p2']);
  assert.deepEqual(d.rooms, []);
  assert.deepEqual(missingBeforeSigning('pre', d), []);
  assert.match(summarize('pre', d).text, /^5 rooms, 0 spots noted, 2 photos$/);
  assert.equal(summarize('pre', { room_count: 1 }).text, '1 room, 0 spots noted');
});

test('the room count is never below the rooms called out, never absurd, and old records get it from their rooms', () => {
  assert.equal(cleanInspection('pre', { room_count: 1, rooms: [blankRoom('A'), blankRoom('B'), blankRoom('C')] }).room_count, 3);
  assert.equal(cleanInspection('pre', { rooms: [blankRoom('A'), blankRoom('B')] }).room_count, 2);
  assert.equal(cleanInspection('pre', { room_count: 9999 }).room_count, 200);
  assert.equal(cleanInspection('pre', { room_count: -3 }).room_count, 0);
  assert.equal(cleanInspection('pre', { room_count: 'lots' }).room_count, 0);
  assert.equal(cleanInspection('pre', null).room_count, 0);
  assert.deepEqual(missingBeforeSigning('post', { room_count: 0 }), ['Enter how many rooms.', 'Tick that you walked through the work with the customer.']);
});

test('photos of the whole job and of called-out rooms are counted together', () => {
  const d = cleanInspection('post', { room_count: 3, photo_ids: ['a', 'b'], rooms: [{ ...blankRoom('Den'), photo_ids: ['b', 'c'] }] });
  assert.deepEqual(inspectionPhotoIds(d).sort(), ['a', 'b', 'c']);
  assert.match(summarize('post', d).text, /3 photos/);
});

test('the after record keeps the room count and called-out rooms but starts with no photos', () => {
  const post = seedPostFromPre({ room_count: 6, photo_ids: ['a'], rooms: [{ ...blankRoom('Den'), photo_ids: ['b'] }], notes: 'old' });
  assert.equal(post.room_count, 6);
  assert.equal(post.rooms.length, 1);
  assert.deepEqual(post.photo_ids, []);
  assert.deepEqual(post.rooms[0].photo_ids, []);
});
