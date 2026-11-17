// Staff messaging helpers. Pure functions: no DOM, no network, so they can be tested on their own.
//
// A message row (table chat_messages):
//   { id, thread_id, author_id, kind: 'text' | 'photo' | 'system', body, photo_path, mentions: [uuid],
//     ack_user_ids: [uuid], ack_notif_key, created_at, edited_at, deleted_at }
// An acknowledgment row (chat_acks): { message_id, user_id, acked_at }
// An inbox row (rpc chat_inbox): { thread_id, kind, job_id, lead_id, label, last_message_at, last_preview,
//   last_author, unread, pending_acks, muted, peer_id, channel_key }
// kind is job | lead | dm | tech_line | channel. For the last three, label is already made for the reader (the other
// person's name; "Office" for a tech's own line; "#dispatch").

import { tagsFromText } from './sketchComments.js';

export const MAX_BODY = 2000;
export const PAGE_SIZE = 60;
export const ACK_WINDOW_DAYS = 14;

export const CHAT_PHOTO_BUCKET = 'chat-photos';

// One-tap replies. Techs are often on a ladder with wet hands, so these send straight away.
const QUICK_TECH = ['On my way', 'Need more equipment', 'Customer not home', 'Running late', 'All done here'];
const QUICK_OFFICE = ['Got it', 'Thanks', 'Call me', 'On it'];
export const quickRepliesFor = (role) => (role === 'tech' ? QUICK_TECH : QUICK_OFFICE);

export function cleanBody(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_BODY);
}

// How a person is named in chat: their saved name, else the start of their email.
export function personName(s) {
  const full = String(s?.full_name ?? '').trim();
  if (full && !full.includes('@')) return full;
  const local = String(s?.email ?? '').split('@')[0].trim();
  return local || 'Someone';
}

// ---- @mentions -----------------------------------------------------------------

// "@office", "@owner" and "@techs" tag a whole group. The app turns them into people before sending.
export const ROLE_MENTIONS = [
  { id: 'role:office', name: 'office', role: 'everyone in the office' },
  { id: 'role:owner', name: 'owner', role: 'the owner' },
  { id: 'role:techs', name: 'techs', role: 'all technicians' },
];
const ROLE_OF = { 'role:office': ['office'], 'role:owner': ['owner'], 'role:techs': ['tech'] };

const ROLE_LABEL = { owner: 'Owner', office: 'Office', tech: 'Technician' };

// What the @ list offers: the groups, then every active person except you.
export function mentionPeople(staff, meId) {
  const people = (staff || [])
    .filter((s) => s && s.id && s.active !== false && s.id !== meId)
    .map((s) => ({ id: s.id, name: personName(s), email: s.email || '', role: ROLE_LABEL[s.role] || '' }));
  return [...ROLE_MENTIONS, ...people];
}

// The people tagged in a piece of text, groups expanded, never yourself, no repeats.
export function mentionIds(text, staff, meId) {
  const tags = tagsFromText(text, mentionPeople(staff, meId));
  const out = new Set();
  for (const t of tags) {
    if (ROLE_OF[t.id]) {
      for (const s of staff || []) {
        if (s && s.active !== false && s.id !== meId && ROLE_OF[t.id].includes(s.role)) out.add(s.id);
      }
    } else if (t.id !== meId) {
      out.add(t.id);
    }
  }
  return [...out].slice(0, 30);
}

// ---- the timeline --------------------------------------------------------------

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function dayLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return 'Today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export const clockTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// [{ key, label, items: [message] }] in time order.
export function groupByDay(messages, now = new Date()) {
  const out = [];
  for (const m of messages || []) {
    const key = dayKey(new Date(m.created_at));
    let g = out[out.length - 1];
    if (!g || g.key !== key) { g = { key, label: dayLabel(m.created_at, now), items: [] }; out.push(g); }
    g.items.push(m);
  }
  return out;
}

// Adds or replaces messages by id and keeps them in time order.
export function mergeMessages(list, incoming) {
  const map = new Map((list || []).map((m) => [m.id, m]));
  for (const m of incoming || []) if (m && m.id) map.set(m.id, { ...(map.get(m.id) || {}), ...m });
  return [...map.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
}

export function mergeAcks(list, incoming) {
  const map = new Map((list || []).map((a) => [`${a.message_id}:${a.user_id}`, a]));
  for (const a of incoming || []) if (a && a.message_id && a.user_id) map.set(`${a.message_id}:${a.user_id}`, a);
  return [...map.values()];
}

// Messages from other people since you last read. System lines never count.
export const isUnreadFor = (m, lastReadAt, meId) =>
  !!m && (m.kind === 'text' || m.kind === 'photo') && !m.deleted_at && m.author_id !== meId
  && (!lastReadAt || m.created_at > lastReadAt);

export const unreadCount = (messages, lastReadAt, meId) => (messages || []).filter((m) => isUnreadFor(m, lastReadAt, meId)).length;
export const firstUnreadId = (messages, lastReadAt, meId) => (messages || []).find((m) => isUnreadFor(m, lastReadAt, meId))?.id ?? null;

// ---- acknowledgments -----------------------------------------------------------

// Who was asked, who has tapped "Got it" (with when), and who is still being waited on.
export function ackState(message, acks) {
  const needed = message?.ack_user_ids || [];
  const mine = (acks || []).filter((a) => a.message_id === message?.id);
  const done = needed.map((id) => mine.find((a) => a.user_id === id)).filter(Boolean).map((a) => ({ user_id: a.user_id, at: a.acked_at }));
  const doneIds = new Set(done.map((d) => d.user_id));
  return { needed, done, waiting: needed.filter((id) => !doneIds.has(id)) };
}

export const needsMyAck = (message, acks, meId) => !!meId && ackState(message, acks).waiting.includes(meId);

// ---- who may edit or delete ------------------------------------------------------

export const canEditMessage = (m, meId) => !!m && m.kind !== 'system' && !m.deleted_at && !!meId && m.author_id === meId && m.kind === 'text';
export const canDeleteMessage = (m, meId, role) =>
  !!m && m.kind !== 'system' && !m.deleted_at && !!meId && (m.author_id === meId || role === 'owner');

// ---- the inbox -----------------------------------------------------------------

// What the badge shows: unread messages in threads that are not muted, plus every change waiting on a "Got it".
export function inboxTotal(rows) {
  let n = 0;
  for (const r of rows || []) n += (r.muted ? 0 : r.unread || 0) + (r.pending_acks || 0);
  return n;
}

// Job and lead chats live on that job's or lead's Chat tab; direct messages, Office lines and channels have their own page.
export const threadHref = (r) => (r.job_id ? `/jobs/${r.job_id}#thread` : r.lead_id ? `/leads/${r.lead_id}#thread` : `/messages/${r.thread_id}`);

// The unread plus waiting count for one job or lead (for the tab badge).
export function countForTarget(rows, { jobId, leadId }) {
  const r = (rows || []).find((x) => (jobId ? x.job_id === jobId : x.lead_id === leadId));
  return r ? (r.muted ? 0 : r.unread || 0) + (r.pending_acks || 0) : 0;
}

export const photoPathFor = (threadId, uuid) => `${threadId}/${uuid}.jpg`;

// Short line for lists and notifications.
export function previewText(m) {
  if (!m) return '';
  if (m.deleted_at) return 'Message deleted';
  if (m.kind === 'photo') return String(m.body || '').trim() || 'Sent a photo';
  return String(m.body || '').slice(0, 120);
}

// True when a tag in a message is for you: your name, or a group you belong to.
export function tagIsMe(tagId, me) {
  if (!me) return false;
  return tagId === me.id
    || (tagId === 'role:office' && me.role === 'office')
    || (tagId === 'role:owner' && me.role === 'owner')
    || (tagId === 'role:techs' && me.role === 'tech');
}
