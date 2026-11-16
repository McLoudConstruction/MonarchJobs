import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanBody, personName, mentionPeople, mentionIds, ROLE_MENTIONS, dayLabel, groupByDay, mergeMessages, mergeAcks,
  isUnreadFor, unreadCount, firstUnreadId, ackState, needsMyAck, canEditMessage, canDeleteMessage, inboxTotal,
  threadHref, countForTarget, previewText, quickRepliesFor, photoPathFor, MAX_BODY,
} from '../lib/chat.js';
import { NOTIFICATION_TYPES, typesForRole } from '../lib/notificationTypes.js';

const staff = [
  { id: 'o1', full_name: 'Stachys M', email: 'o@x.com', role: 'owner', active: true },
  { id: 'f1', full_name: 'Fran Office', email: 'f@x.com', role: 'office', active: true },
  { id: 'f2', full_name: '', email: 'gina.office@x.com', role: 'office', active: true },
  { id: 't1', full_name: 'Tim Tech', email: 't@x.com', role: 'tech', active: true },
  { id: 't2', full_name: 'Tara Tech', email: 'tt@x.com', role: 'tech', active: true },
  { id: 't3', full_name: 'Old Tech', email: 'old@x.com', role: 'tech', active: false },
];

test('cleanBody trims, fixes line endings and caps length', () => {
  assert.equal(cleanBody('  hi\r\nthere  '), 'hi\nthere');
  assert.equal(cleanBody(null), '');
  assert.equal(cleanBody('x'.repeat(MAX_BODY + 50)).length, MAX_BODY);
});

test('personName uses the saved name, else the start of the email', () => {
  assert.equal(personName({ full_name: 'Tim Tech', email: 't@x.com' }), 'Tim Tech');
  assert.equal(personName({ full_name: 'a@b.com', email: 'tim@x.com' }), 'tim');
  assert.equal(personName({ full_name: '', email: 'gina.office@x.com' }), 'gina.office');
  assert.equal(personName(null), 'Someone');
});

test('the @ list has the groups first, then active people except you', () => {
  const list = mentionPeople(staff, 't1');
  assert.deepEqual(list.slice(0, 3).map((p) => p.id), ROLE_MENTIONS.map((r) => r.id));
  const ids = list.map((p) => p.id);
  assert.ok(!ids.includes('t1'), 'not yourself');
  assert.ok(!ids.includes('t3'), 'not an inactive person');
  assert.ok(ids.includes('o1') && ids.includes('f1') && ids.includes('t2'));
});

test('mentionIds finds people by full name', () => {
  assert.deepEqual(mentionIds('Hey @Fran Office can you call?', staff, 't1'), ['f1']);
  assert.deepEqual(mentionIds('no tags here', staff, 't1'), []);
  assert.deepEqual(mentionIds('@Fran Office and @Fran Office again', staff, 't1'), ['f1']);
});

test('group mentions expand to the active people with that role, never you', () => {
  assert.deepEqual(mentionIds('@office please check', staff, 't1').sort(), ['f1', 'f2', 'o1'].filter((id) => id !== 'o1').sort());
  assert.deepEqual(mentionIds('@owner call me', staff, 't1'), ['o1']);
  assert.deepEqual(mentionIds('@techs tomorrow is moved', staff, 't1'), ['t2']);
  assert.deepEqual(mentionIds('@techs tomorrow is moved', staff, 'f1').sort(), ['t1', 't2']);
});

test('tagging yourself by name does nothing', () => {
  assert.deepEqual(mentionIds('@Tim Tech', staff, 't1'), []);
});

test('day labels and grouping', () => {
  const now = new Date(2026, 10, 16, 12, 0, 0);
  assert.equal(dayLabel(new Date(2026, 10, 16, 8, 0).toISOString(), now), 'Today');
  assert.equal(dayLabel(new Date(2026, 10, 15, 22, 0).toISOString(), now), 'Yesterday');
  const msgs = [
    { id: 'a', created_at: new Date(2026, 10, 15, 9, 0).toISOString() },
    { id: 'b', created_at: new Date(2026, 10, 15, 10, 0).toISOString() },
    { id: 'c', created_at: new Date(2026, 10, 16, 9, 0).toISOString() },
  ];
  const g = groupByDay(msgs, now);
  assert.equal(g.length, 2);
  assert.deepEqual(g.map((x) => x.items.length), [2, 1]);
  assert.deepEqual(g.map((x) => x.label), ['Yesterday', 'Today']);
});

test('mergeMessages replaces by id, keeps time order and fills in changes', () => {
  const a = { id: '1', created_at: '2026-11-16T10:00:00Z', body: 'one' };
  const b = { id: '2', created_at: '2026-11-16T10:01:00Z', body: 'two' };
  let list = mergeMessages([], [b, a]);
  assert.deepEqual(list.map((m) => m.id), ['1', '2']);
  list = mergeMessages(list, [{ id: '1', body: 'one!', edited_at: 'x' }]);
  assert.equal(list[0].body, 'one!');
  assert.equal(list[0].created_at, a.created_at);
  assert.equal(list.length, 2);
});

test('mergeAcks never duplicates a person on a message', () => {
  let acks = mergeAcks([], [{ message_id: 'm', user_id: 'u', acked_at: '1' }]);
  acks = mergeAcks(acks, [{ message_id: 'm', user_id: 'u', acked_at: '1' }, { message_id: 'm', user_id: 'v', acked_at: '2' }]);
  assert.equal(acks.length, 2);
});

test('unread counts other people’s messages only, and system lines never count', () => {
  const last = '2026-11-16T10:00:00Z';
  const msgs = [
    { id: '1', kind: 'text', author_id: 'f1', created_at: '2026-11-16T09:59:00Z' },
    { id: '2', kind: 'text', author_id: 'f1', created_at: '2026-11-16T10:01:00Z' },
    { id: '3', kind: 'photo', author_id: 't1', created_at: '2026-11-16T10:02:00Z' },
    { id: '4', kind: 'system', author_id: 'f1', created_at: '2026-11-16T10:03:00Z' },
    { id: '5', kind: 'text', author_id: 'f1', created_at: '2026-11-16T10:04:00Z', deleted_at: '2026-11-16T10:05:00Z' },
    { id: '6', kind: 'text', author_id: 'f2', created_at: '2026-11-16T10:06:00Z' },
  ];
  assert.equal(unreadCount(msgs, last, 't1'), 2); // 2 and 6
  assert.equal(firstUnreadId(msgs, last, 't1'), '2');
  assert.equal(unreadCount(msgs, null, 't1'), 3); // never read: 1, 2, 6
  assert.equal(isUnreadFor(msgs[3], null, 't1'), false);
});

test('acknowledgment state', () => {
  const m = { id: 'm1', kind: 'system', ack_user_ids: ['t1', 't2'] };
  const acks = [{ message_id: 'm1', user_id: 't1', acked_at: '2026-11-16T11:00:00Z' }, { message_id: 'other', user_id: 't2', acked_at: 'x' }];
  const s = ackState(m, acks);
  assert.deepEqual(s.done, [{ user_id: 't1', at: '2026-11-16T11:00:00Z' }]);
  assert.deepEqual(s.waiting, ['t2']);
  assert.equal(needsMyAck(m, acks, 't2'), true);
  assert.equal(needsMyAck(m, acks, 't1'), false);
  assert.equal(needsMyAck(m, acks, 'f1'), false);
  assert.deepEqual(ackState({ id: 'x' }, []).waiting, []);
});

test('who can edit and delete', () => {
  const mine = { id: '1', kind: 'text', author_id: 't1' };
  assert.equal(canEditMessage(mine, 't1'), true);
  assert.equal(canEditMessage(mine, 'f1'), false);
  assert.equal(canEditMessage({ ...mine, kind: 'photo' }, 't1'), false);
  assert.equal(canEditMessage({ ...mine, deleted_at: 'x' }, 't1'), false);
  assert.equal(canDeleteMessage(mine, 't1', 'tech'), true);
  assert.equal(canDeleteMessage(mine, 'f1', 'office'), false);
  assert.equal(canDeleteMessage(mine, 'o1', 'owner'), true);
  assert.equal(canDeleteMessage({ id: 's', kind: 'system', author_id: 't1' }, 'o1', 'owner'), false);
});

test('inbox badge counts unread in unmuted threads plus every change waiting on a Got it', () => {
  const rows = [
    { thread_id: 'a', unread: 2, pending_acks: 1, muted: false },
    { thread_id: 'b', unread: 5, pending_acks: 0, muted: true },
    { thread_id: 'c', unread: 0, pending_acks: 1, muted: true },
  ];
  assert.equal(inboxTotal(rows), 4);
  assert.equal(inboxTotal([]), 0);
  assert.equal(inboxTotal(null), 0);
});

test('links and per-job counts', () => {
  assert.equal(threadHref({ job_id: 'j1' }), '/jobs/j1#thread');
  assert.equal(threadHref({ lead_id: 'l1' }), '/leads/l1#thread');
  const rows = [{ job_id: 'j1', unread: 3, pending_acks: 1, muted: false }, { lead_id: 'l1', unread: 4, pending_acks: 0, muted: true }];
  assert.equal(countForTarget(rows, { jobId: 'j1' }), 4);
  assert.equal(countForTarget(rows, { leadId: 'l1' }), 0);
  assert.equal(countForTarget(rows, { jobId: 'nope' }), 0);
});

test('previews, quick replies and photo paths', () => {
  assert.equal(previewText({ kind: 'photo', body: '' }), 'Sent a photo');
  assert.equal(previewText({ kind: 'photo', body: 'Wet wall' }), 'Wet wall');
  assert.equal(previewText({ kind: 'text', body: 'hello', deleted_at: 'x' }), 'Message deleted');
  assert.ok(quickRepliesFor('tech').includes('Customer not home'));
  assert.ok(quickRepliesFor('office').includes('Got it'));
  assert.equal(photoPathFor('t', 'u'), 't/u.jpg');
});

test('chat notification types exist for every role and are grouped under Messages', () => {
  for (const key of ['chat_mention', 'chat_message']) {
    const t = NOTIFICATION_TYPES[key];
    assert.ok(t, key);
    assert.equal(t.group, 'Messages');
    for (const role of ['owner', 'office', 'tech']) assert.ok(typesForRole(role).some((x) => x.key === key), `${key} for ${role}`);
  }
  assert.equal(NOTIFICATION_TYPES.chat_message.grouped, true);
});

import { tagIsMe } from '../lib/chat.js';
test('a group tag is for you when you are in the group', () => {
  assert.equal(tagIsMe('t1', { id: 't1', role: 'tech' }), true);
  assert.equal(tagIsMe('role:techs', { id: 't1', role: 'tech' }), true);
  assert.equal(tagIsMe('role:office', { id: 't1', role: 'tech' }), false);
  assert.equal(tagIsMe('role:owner', { id: 'o1', role: 'owner' }), true);
  assert.equal(tagIsMe('role:office', null), false);
});
