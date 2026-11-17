import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rowDisplay, orderRows, filterRows, peopleForPicker, openWindow, closeWindow, minimizeWindow, fitWindows, maxExpandedFor,
  serializeDock, parseDock, bubbleHidden, badgeText, MAX_PILLS,
} from '../lib/chatDock.js';
import { threadHref } from '../lib/chat.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (o) => ({ thread_id: id(1), kind: 'job', label: '#1042 Ada', last_message_at: '2026-11-16T10:00:00Z', last_preview: '', last_author: '', unread: 0, pending_acks: 0, muted: false, ...o });

test('rows are named for the reader, and each kind says what it is', () => {
  assert.deepEqual(rowDisplay(row({ kind: 'tech_line', label: 'Office' }), 'tech'), { title: 'Office', sub: 'Owner and office', initial: 'O' });
  assert.equal(rowDisplay(row({ kind: 'tech_line', label: 'Maria' }), 'owner').sub, 'Technician · shared with the office');
  assert.equal(rowDisplay(row({ kind: 'channel', label: '#dispatch' }), 'tech').initial, '#');
  assert.equal(rowDisplay(row({ kind: 'dm', label: 'Dana' }), 'tech').sub, 'Private');
});

test('the list puts what needs you first, a tech\'s Office line next, then unread, then newest', () => {
  const rows = [
    row({ thread_id: 'old', last_message_at: '2026-11-10T00:00:00Z' }),
    row({ thread_id: 'new', last_message_at: '2026-11-16T09:00:00Z' }),
    row({ thread_id: 'unread', unread: 2, last_message_at: '2026-11-11T00:00:00Z' }),
    row({ thread_id: 'muted-unread', unread: 5, muted: true, last_message_at: '2026-11-12T00:00:00Z' }),
    row({ thread_id: 'ack', pending_acks: 1, last_message_at: '2026-11-01T00:00:00Z' }),
    row({ thread_id: 'line', kind: 'tech_line', last_message_at: '2026-11-02T00:00:00Z' }),
  ];
  assert.deepEqual(orderRows(rows, 'tech').map((r) => r.thread_id), ['ack', 'line', 'unread', 'new', 'muted-unread', 'old']);
  // for the office a tech line is an ordinary conversation
  assert.deepEqual(orderRows(rows, 'owner').map((r) => r.thread_id), ['ack', 'unread', 'new', 'muted-unread', 'old', 'line']);
});

test('filters: search, unread only, people, jobs', () => {
  const rows = [row({ thread_id: 'a', label: '#1 Smith', last_preview: 'gate code' }), row({ thread_id: 'b', kind: 'dm', label: 'Dana', unread: 1 }), row({ thread_id: 'c', kind: 'channel', label: '#dispatch' }), row({ thread_id: 'd', kind: 'lead', label: 'Lee', pending_acks: 1 })];
  assert.deepEqual(filterRows(rows, { query: 'GATE' }).map((r) => r.thread_id), ['a']);
  assert.deepEqual(filterRows(rows, { mode: 'unread' }).map((r) => r.thread_id), ['b', 'd']);
  assert.deepEqual(filterRows(rows, { mode: 'people' }).map((r) => r.thread_id), ['b', 'c']);
  assert.deepEqual(filterRows(rows, { mode: 'jobs' }).map((r) => r.thread_id), ['a', 'd']);
});

test('new message: office and owner reach a tech through the shared Office line, with a private option', () => {
  const staff = [{ id: 'o', role: 'owner', full_name: 'Dana' }, { id: 't1', role: 'tech', full_name: 'Maria' }, { id: 'f', role: 'office', full_name: 'Olive' }, { id: 'x', role: 'tech', full_name: 'Gone', active: false }, { id: 't2', role: 'tech', email: 'bo@x.com' }];
  const asOwner = peopleForPicker(staff, { id: 'o', role: 'owner' });
  assert.deepEqual(asOwner.map((p) => p.name), ['bo', 'Maria', 'Olive']);
  assert.deepEqual(asOwner.find((p) => p.id === 't1'), { id: 't1', name: 'Maria', role: 'tech', action: 'tech_line', canPrivate: true });
  assert.equal(asOwner.find((p) => p.id === 'f').action, 'dm');
  const asTech = peopleForPicker(staff, { id: 't1', role: 'tech' });
  assert.ok(asTech.every((p) => p.action === 'dm' && !p.canPrivate)); // a tech to anyone is a plain private message
  assert.ok(!asTech.some((p) => p.id === 't1'));
});

test('windows: newest nearest the list, oldest shrink to tabs, reopening restores', () => {
  let w = [];
  for (const n of [1, 2, 3]) w = openWindow(w, { threadId: id(n), title: `T${n}` }, 3);
  assert.deepEqual(w.map((x) => x.minimized), [false, false, false]);
  w = openWindow(w, { threadId: id(4), title: 'T4' }, 3);
  assert.deepEqual(w.map((x) => [x.title, x.minimized]), [['T1', true], ['T2', false], ['T3', false], ['T4', false]]);
  w = openWindow(w, { threadId: id(1) }, 3); // restoring T1 moves it last and shrinks the oldest open one
  assert.deepEqual(w.map((x) => [x.title, x.minimized]), [['T2', true], ['T3', false], ['T4', false], ['T1', false]]);
  assert.equal(w.find((x) => x.threadId === id(1)).title, 'T1'); // title kept when reopened without one
  assert.equal(closeWindow(w, id(3)).length, 3);
  assert.equal(minimizeWindow(w, id(4)).find((x) => x.threadId === id(4)).minimized, true);
});

test('at most three tabs are kept', () => {
  let w = [];
  for (let n = 1; n <= 8; n++) w = openWindow(w, { threadId: id(n), title: `T${n}` }, 1);
  assert.equal(w.filter((x) => x.minimized).length, MAX_PILLS);
  assert.equal(w.filter((x) => !x.minimized).length, 1);
  assert.equal(w[w.length - 1].title, 'T8');
});

test('window width decides how many windows fit', () => {
  assert.equal(maxExpandedFor(900), 1);
  assert.equal(maxExpandedFor(1280), 2);
  assert.equal(maxExpandedFor(1920), 3);
  assert.equal(maxExpandedFor(0), 1);
  const w = fitWindows([{ threadId: 'a', minimized: false }, { threadId: 'b', minimized: false }, { threadId: 'c', minimized: false }], 1);
  assert.deepEqual(w.map((x) => x.minimized), [true, true, false]);
});

test('open windows survive a page change but never trust bad saved data', () => {
  const state = { panel: true, windows: [{ threadId: id(1), title: 'Maria', href: '/jobs/x#thread', minimized: true }] };
  assert.deepEqual(parseDock(serializeDock(state)), state);
  assert.deepEqual(parseDock('not json'), { panel: false, windows: [] });
  assert.deepEqual(parseDock(JSON.stringify({ v: 2, windows: [] })), { panel: false, windows: [] });
  const bad = parseDock(JSON.stringify({ v: 1, windows: [{ threadId: 'x', title: 'no' }, { threadId: id(2), title: 'ok', href: 'https://evil.test' }] }));
  assert.deepEqual(bad.windows, [{ threadId: id(2), title: 'ok', href: null, minimized: false }]);
});

test('links: job and lead chats stay on their Chat tab, the rest have a page', () => {
  assert.equal(threadHref({ job_id: 'j1', thread_id: 't' }), '/jobs/j1#thread');
  assert.equal(threadHref({ lead_id: 'l1', thread_id: 't' }), '/leads/l1#thread');
  assert.equal(threadHref({ kind: 'dm', thread_id: 't9' }), '/messages/t9');
});

test('the phone bubble steps aside on job screens and the full conversation', () => {
  assert.equal(bubbleHidden('/jobs/abc'), true);
  assert.equal(bubbleHidden('/jobs/new'), false);
  assert.equal(bubbleHidden('/jobs'), false);
  assert.equal(bubbleHidden('/dashboard'), false);
  assert.equal(bubbleHidden('/messages/xyz'), true);
  assert.equal(badgeText(0), ''); assert.equal(badgeText(7), '7'); assert.equal(badgeText(120), '99+');
});
