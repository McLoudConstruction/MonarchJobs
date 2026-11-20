import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REACTIONS, MAX_PINS, canPinMessage, isPinned, pinnedMessages, mergePins, mergeReactions, removeReaction, reactionSummary,
  searchTerm, canSearch, likePattern, matchesSearch, highlightParts, snippet,
  pickVoiceFormat, voicePathFor, durationText, voiceSeconds, VOICE_MAX_SECS, previewText, isUnreadFor, unreadCount,
} from '../lib/chat.js';

const msg = (o) => ({ id: 'm', kind: 'text', body: '', created_at: '2026-11-20T10:00:00Z', author_id: 'a', ...o });

test('pins: system lines and deleted messages cannot be pinned; pinned list is newest pin first', () => {
  assert.equal(canPinMessage(msg({})), true);
  assert.equal(canPinMessage(msg({ kind: 'system' })), false);
  assert.equal(canPinMessage(msg({ deleted_at: 'x' })), false);
  const list = [msg({ id: '1', pinned_at: '2026-11-20T10:00:00Z' }), msg({ id: '2' }), msg({ id: '3', pinned_at: '2026-11-20T11:00:00Z' }), msg({ id: '4', pinned_at: '2026-11-20T12:00:00Z', deleted_at: 'x' })];
  assert.deepEqual(pinnedMessages(list).map((m) => m.id), ['3', '1']);
  assert.equal(isPinned(list[0]), true);
  assert.equal(isPinned(list[3]), false);
  assert.equal(MAX_PINS, 10);
});

test('mergePins: fetched pins plus loaded messages; a loaded unpin wins; a loaded new pin shows', () => {
  const fetched = [msg({ id: 'old', pinned_at: '2026-11-01T00:00:00Z', body: 'gate code' }), msg({ id: 'b', pinned_at: '2026-11-10T00:00:00Z' })];
  const loaded = [msg({ id: 'b', pinned_at: null }), msg({ id: 'c', pinned_at: '2026-11-20T00:00:00Z' })];
  assert.deepEqual(mergePins(fetched, loaded).map((m) => m.id), ['c', 'old']);
  assert.deepEqual(mergePins([], []), []);
});

test('reactions: merge is idempotent, removal works, summary counts in the fixed order and marks mine', () => {
  const r = (message_id, user_id, emoji) => ({ message_id, user_id, emoji });
  let list = mergeReactions([], [r('m1', 'u1', '✅'), r('m1', 'u2', '👍'), r('m1', 'u1', '👍')]);
  list = mergeReactions(list, [r('m1', 'u1', '✅')]);
  assert.equal(list.length, 3);
  const s = reactionSummary(list, 'm1', 'u1');
  assert.deepEqual(s.map((x) => [x.emoji, x.count, x.mine]), [['👍', 2, true], ['✅', 1, true]]);
  assert.deepEqual(reactionSummary(list, 'm1', 'u9').map((x) => x.mine), [false, false]);
  assert.deepEqual(reactionSummary(list, 'other', 'u1'), []);
  list = removeReaction(list, r('m1', 'u1', '✅'));
  assert.equal(list.length, 2);
  assert.equal(removeReaction(list, null), list);
  assert.deepEqual(REACTIONS, ['👍', '✅', '👀', '🙏', '😊']);
});

test('search: terms are trimmed and need two letters; like patterns escape % _ and backslash', () => {
  assert.equal(searchTerm('  gate   code '), 'gate code');
  assert.equal(canSearch('a'), false);
  assert.equal(canSearch(' ab '), true);
  assert.equal(likePattern('50%_a\\b'), '%50\\%\\_a\\\\b%');
  assert.equal(searchTerm('x'.repeat(200)).length, 80);
});

test('search: matches ignore case, deleted and system messages; highlight and snippet', () => {
  assert.equal(matchesSearch(msg({ body: 'Gate Code is 4471' }), 'gate code'), true);
  assert.equal(matchesSearch(msg({ body: 'gate', deleted_at: 'x' }), 'gate'), false);
  assert.equal(matchesSearch(msg({ body: 'gate', kind: 'system' }), 'gate'), false);
  assert.equal(matchesSearch(msg({ body: 'gate' }), 'g'), false);
  assert.deepEqual(highlightParts('Hello hello', 'ell').filter((p) => p.hit).length, 2);
  assert.deepEqual(highlightParts('nothing', 'zz'), [{ s: 'nothing', hit: false }]);
  assert.deepEqual(highlightParts('abc', 'a'), [{ s: 'abc', hit: false }]);
  const long = `${'x'.repeat(100)} needle ${'y'.repeat(100)}`;
  const sn = snippet(long, 'needle', 10);
  assert.ok(sn.startsWith('…') && sn.endsWith('…') && sn.includes('needle') && sn.length < 40);
  assert.equal(snippet('short needle here', 'needle'), 'short needle here');
});

test('voice: picks the first format the phone supports, builds paths, formats time', () => {
  assert.deepEqual(pickVoiceFormat((m) => m === 'audio/mp4'), { mime: 'audio/mp4', ext: 'm4a', type: 'audio/mp4' });
  assert.deepEqual(pickVoiceFormat((m) => m.startsWith('audio/webm')), { mime: 'audio/webm;codecs=opus', ext: 'webm', type: 'audio/webm' });
  assert.equal(pickVoiceFormat(() => false), null);
  assert.equal(pickVoiceFormat(() => { throw new Error('x'); }), null);
  assert.equal(voicePathFor('t1', 'u1', 'm4a'), 't1/u1.m4a');
  assert.equal(durationText(65), '1:05');
  assert.equal(durationText(7), '0:07');
  assert.equal(durationText(null), '0:00');
  assert.equal(voiceSeconds(400), null);
  assert.equal(voiceSeconds(1400), 1);
  assert.equal(voiceSeconds(9999999), VOICE_MAX_SECS);
});

test('voice notes preview, and count as unread like other messages', () => {
  const v = msg({ kind: 'voice', voice_secs: 12, voice_path: 'p' });
  assert.equal(previewText(v), 'Voice note (0:12)');
  assert.equal(previewText({ ...v, deleted_at: 'x' }), 'Message deleted');
  assert.equal(isUnreadFor(v, '2026-11-20T09:00:00Z', 'me'), true);
  assert.equal(isUnreadFor({ ...v, author_id: 'me' }, null, 'me'), false);
  assert.equal(unreadCount([v, msg({ id: 'x', kind: 'system' })], null, 'me'), 1);
});
