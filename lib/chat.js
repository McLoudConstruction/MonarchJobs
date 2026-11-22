// Staff messaging helpers. Pure functions: no DOM, no network, so they can be tested on their own.
//
// A message row (table chat_messages):
//   { id, thread_id, author_id, kind: 'text' | 'photo' | 'voice' | 'system', body, photo_path, voice_path, voice_secs,
//     mentions: [uuid], ack_user_ids: [uuid], ack_notif_key, created_at, edited_at, deleted_at, pinned_at, pinned_by }
// A reaction row (table chat_reactions): { message_id, thread_id, user_id, emoji, created_at }
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
export const CHAT_VOICE_BUCKET = 'chat-voice';

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
  !!m && (m.kind === 'text' || m.kind === 'photo' || m.kind === 'voice') && !m.deleted_at && m.author_id !== meId
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

// A system line that is a sentence on its own ("Dana has now been assigned"), shown without "<who> " in front of it.
export const isBareSystemLine = (body) => / has now been assigned$/.test(String(body || ''));

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
  if (m.kind === 'voice') return `Voice note (${durationText(m.voice_secs)})`;
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

// ---- pinned messages -------------------------------------------------------------

export const MAX_PINS = 10;

export const canPinMessage = (m) => !!m && m.kind !== 'system' && !m.deleted_at;
export const isPinned = (m) => !!m && !!m.pinned_at && !m.deleted_at;

// Pinned messages, the most recently pinned first.
export function pinnedMessages(messages) {
  return (messages || []).filter(isPinned).sort((a, b) => (a.pinned_at < b.pinned_at ? 1 : a.pinned_at > b.pinned_at ? -1 : 0));
}

// ---- reactions -------------------------------------------------------------------

// A short, calm set. The database accepts only these.
export const REACTIONS = ['👍', '✅', '👀', '🙏', '😊'];

export const reactionKey = (r) => `${r.message_id}:${r.user_id}:${r.emoji}`;

export function mergeReactions(list, incoming) {
  const map = new Map((list || []).map((r) => [reactionKey(r), r]));
  for (const r of incoming || []) if (r && r.message_id && r.user_id && r.emoji) map.set(reactionKey(r), r);
  return [...map.values()];
}

export function removeReaction(list, gone) {
  if (!gone || !gone.message_id || !gone.user_id || !gone.emoji) return list || [];
  const k = reactionKey(gone);
  return (list || []).filter((r) => reactionKey(r) !== k);
}

// [{ emoji, count, mine, userIds }] for one message, in the order of REACTIONS, only those used.
export function reactionSummary(reactions, messageId, meId) {
  const out = [];
  for (const emoji of REACTIONS) {
    const ids = (reactions || []).filter((r) => r.message_id === messageId && r.emoji === emoji).map((r) => r.user_id);
    if (ids.length) out.push({ emoji, count: ids.length, mine: ids.includes(meId), userIds: ids });
  }
  return out;
}

// ---- search inside a chat --------------------------------------------------------

export const MIN_SEARCH = 2;
export const SEARCH_LIMIT = 40;

export const searchTerm = (q) => String(q ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
export const canSearch = (q) => searchTerm(q).length >= MIN_SEARCH;

// For a database "ilike": % and _ and \ in what the person typed mean themselves.
export const likePattern = (q) => `%${searchTerm(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// The same match, done on messages already loaded (text and photo captions only; not deleted).
export function matchesSearch(m, q) {
  if (!m || m.deleted_at || m.kind === 'system' || !canSearch(q)) return false;
  return String(m.body || '').toLowerCase().includes(searchTerm(q).toLowerCase());
}

// [{ s, hit }] pieces of a text, with the matching pieces marked, for showing a result.
export function highlightParts(text, q) {
  const src = String(text ?? '');
  if (!canSearch(q)) return [{ s: src, hit: false }];
  const needle = searchTerm(q).toLowerCase();
  const low = src.toLowerCase();
  const out = [];
  let at = 0;
  for (;;) {
    const i = low.indexOf(needle, at);
    if (i < 0) break;
    if (i > at) out.push({ s: src.slice(at, i), hit: false });
    out.push({ s: src.slice(i, i + needle.length), hit: true });
    at = i + needle.length;
  }
  if (at < src.length) out.push({ s: src.slice(at), hit: false });
  return out.length ? out : [{ s: src, hit: false }];
}

// A short piece of a long message around the first match, so a result shows why it matched.
export function snippet(text, q, radius = 40) {
  const src = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!canSearch(q)) return src.slice(0, radius * 2);
  const i = src.toLowerCase().indexOf(searchTerm(q).toLowerCase());
  if (i < 0) return src.slice(0, radius * 2);
  const from = Math.max(0, i - radius);
  const to = Math.min(src.length, i + searchTerm(q).length + radius);
  return `${from > 0 ? '…' : ''}${src.slice(from, to)}${to < src.length ? '…' : ''}`;
}

// ---- voice notes -------------------------------------------------------------------

export const VOICE_MAX_SECS = 120;
export const VOICE_MIN_SECS = 1;
export const VOICE_MAX_BYTES = 5 * 1024 * 1024;

// Formats the phone can record, best first. iPhones record mp4 (AAC); Android and desktop Chrome record webm (Opus).
const VOICE_FORMATS = [
  { mime: 'audio/mp4', ext: 'm4a' },
  { mime: 'audio/webm;codecs=opus', ext: 'webm', base: 'audio/webm' },
  { mime: 'audio/webm', ext: 'webm' },
  { mime: 'audio/ogg;codecs=opus', ext: 'ogg', base: 'audio/ogg' },
];

// supported: (mime) => boolean, normally MediaRecorder.isTypeSupported. null when nothing works.
export function pickVoiceFormat(supported) {
  for (const f of VOICE_FORMATS) {
    let ok = false;
    try { ok = !!supported(f.mime); } catch { ok = false; }
    if (ok) return { mime: f.mime, ext: f.ext, type: f.base || f.mime };
  }
  return null;
}

export const voicePathFor = (threadId, uuid, ext) => `${threadId}/${uuid}.${ext}`;

// 0:07, 1:05
export function durationText(secs) {
  const n = Math.max(0, Math.round(Number(secs) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

// Whole seconds for the database (1 to 120), or null when the recording is too short to send.
export function voiceSeconds(ms) {
  const n = Math.round((Number(ms) || 0) / 1000);
  if (n < VOICE_MIN_SECS) return null;
  return Math.min(VOICE_MAX_SECS, n);
}

// Pinned messages for the bar at the top: those fetched when the chat opened (which may be older than the loaded page), with
// whatever is loaded in the timeline winning, so a pin or unpin made this minute shows at once.
export function mergePins(pinnedRows, messages) {
  const map = new Map((pinnedRows || []).map((m) => [m.id, m]));
  for (const m of messages || []) if (map.has(m.id) || m.pinned_at) map.set(m.id, { ...(map.get(m.id) || {}), ...m });
  return pinnedMessages([...map.values()]);
}
