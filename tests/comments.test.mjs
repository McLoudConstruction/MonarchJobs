import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanComments, mentionQuery, filterPeople, applyMention, segments, tagsFromText, hitComment, mentionsPerson, timeAgo } from '../lib/sketchComments.js';
import { normalizePlan, planBounds, emptyPlan } from '../lib/sketch.js';

const people = [
  { id: 'u1', name: 'Jo Smith', email: 'jo@x.com' },
  { id: 'u2', name: 'Joanna Park', email: 'jp@x.com' },
  { id: 'u3', name: 'Sam Rivera', email: 'sam.r@x.com' },
  { id: 'u4', name: 'Ann-Marie Jones', email: 'am@x.com' },
];
let n = 0; const uid = (v) => (typeof v === 'string' && v ? v : `id${n++}`);

test('mentionQuery: only an @ that starts a word', () => {
  assert.deepEqual(mentionQuery('hi @jo', 6), { start: 3, query: 'jo' });
  assert.deepEqual(mentionQuery('@', 1), { start: 0, query: '' });
  assert.equal(mentionQuery('mail me@x.com', 13), null);
  assert.equal(mentionQuery('hi @jo smith is here now', 24), null);
  assert.equal(mentionQuery('no at sign', 5), null);
  assert.equal(mentionQuery('hi @jo\nnext', 11), null);
});

test('filterPeople filters as you type, best match first', () => {
  assert.deepEqual(filterPeople(people, '').map((p) => p.id), ['u4', 'u1', 'u2', 'u3']);
  assert.deepEqual(filterPeople(people, 'jo').map((p) => p.id), ['u1', 'u2', 'u4']);
  assert.deepEqual(filterPeople(people, 'park').map((p) => p.id), ['u2']);
  assert.deepEqual(filterPeople(people, 'JO S').map((p) => p.id), ['u1']);
  assert.deepEqual(filterPeople(people, 'sam.r').map((p) => p.id), ['u3']);
  assert.deepEqual(filterPeople(people, 'zz'), []);
});

test('applyMention swaps the typed @query for the name', () => {
  const r = applyMention('check this @jo please', 14, people[0]);
  assert.equal(r.text, 'check this @Jo Smith  please');
  assert.equal(r.caret, 'check this @Jo Smith '.length);
});

test('segments and tagsFromText find full-name tags, longest first', () => {
  const t = 'Hey @Joanna Park and @Jo Smith, look. Email jo@x.com @Nobody';
  assert.deepEqual(tagsFromText(t, people).map((x) => x.id), ['u2', 'u1']);
  assert.equal(segments(t, people).filter((s) => s.tag).length, 2);
  assert.deepEqual(tagsFromText('@Jo Smithson', people), []); // not a whole name
  assert.deepEqual(tagsFromText('@jo smith', people).map((x) => x.id), ['u1']); // case-insensitive
});

test('cleanComments drops junk, trims, caps, keeps replies', () => {
  const out = cleanComments([
    { x: 3, y: 4, text: '  hi  ', by: { id: 'u1', name: 'Jo' }, at: '2026-01-01T00:00:00Z', tags: [{ id: 'u2', name: 'Jo P' }, { id: 'u2', name: 'dup' }], replies: [{ text: 'ok', by: { name: 'Sam' } }, { text: '   ' }] },
    { x: 'a', y: 1, text: 'bad' }, { x: 1, y: 1, text: '' }, null,
  ], uid);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'hi');
  assert.equal(out[0].tags.length, 1);
  assert.equal(out[0].replies.length, 1);
  assert.equal(out[0].at, '2026-01-01T00:00:00.000Z');
  assert.equal(out[0].done, false);
});

test('plans carry comments and bounds include them', () => {
  assert.deepEqual(emptyPlan().comments, []);
  const p = normalizePlan({ rooms: [], comments: [{ x: 50, y: 60, text: 'look' }] });
  assert.equal(p.comments.length, 1);
  const b = planBounds(p);
  assert.ok(b && b.maxX >= 50 && b.minY <= 58);
  assert.deepEqual(normalizePlan({}).comments, []);
});

test('hitComment finds the bubble above the spot', () => {
  const plan = { comments: [{ id: 'a', x: 10, y: 10 }] };
  assert.equal(hitComment(plan, 10, 10 - 15 / 14, 14)?.id, 'a'); // bubble centre
  assert.equal(hitComment(plan, 10, 10, 14)?.id, 'a'); // the tip
  assert.equal(hitComment(plan, 20, 20, 14), null);
});

test('mentionsPerson: open threads that tag you, in the comment or a reply', () => {
  const c = { done: false, tags: [{ id: 'u1' }], replies: [{ tags: [{ id: 'u3' }] }] };
  assert.ok(mentionsPerson(c, 'u1')); assert.ok(mentionsPerson(c, 'u3'));
  assert.ok(!mentionsPerson(c, 'u2')); assert.ok(!mentionsPerson({ ...c, done: true }, 'u1'));
});

test('timeAgo', () => {
  const now = Date.parse('2026-06-01T12:00:00Z');
  assert.equal(timeAgo('2026-06-01T11:59:50Z', now), 'just now');
  assert.equal(timeAgo('2026-06-01T11:30:00Z', now), '30 min ago');
  assert.equal(timeAgo('2026-06-01T09:00:00Z', now), '3 h ago');
  assert.equal(timeAgo('2026-05-30T12:00:00Z', now), '2 d ago');
  assert.equal(timeAgo('', now), '');
});
