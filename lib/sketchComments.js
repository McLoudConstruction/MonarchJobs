// Comments pinned to a spot on a sketch, with @-tagging of team members. Pure functions, no DOM.
//
// A comment: { id, x, y, text, by: { id, name }, at: ISO string, tags: [{ id, name }], done, replies: [reply], log: [{ a, by, at }] }
// log is who did what and when (created, replied, resolved, reopened, moved).
// A reply:   { id, text, by, at, tags }
// Tags are worked out from the text ("@Jo Smith ...") so editing the text can never leave a stale tag.

export const MAX_COMMENTS = 200;
export const MAX_REPLIES = 60;
export const MAX_COMMENT_TEXT = 600;
export const MAX_LOG = 100;

const LOG_ACTIONS = ['created', 'replied', 'resolved', 'reopened', 'moved'];

const COORD = 5000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (n) => Math.round(n * 100) / 100;
const isoOrEmpty = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };
const cleanBy = (b) => ({ id: b && typeof b.id === 'string' ? b.id.slice(0, 64) : null, name: String((b && b.name) ?? '').trim().slice(0, 60) || 'Someone' });
const cleanTags = (list) => {
  const seen = new Set();
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (!t || typeof t.id !== 'string' || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({ id: t.id.slice(0, 64), name: String(t.name ?? '').slice(0, 60) });
    if (out.length >= 12) break;
  }
  return out;
};

const cleanLog = (list) => (Array.isArray(list) ? list : [])
  .filter((l) => l && LOG_ACTIONS.includes(l.a))
  .slice(-MAX_LOG)
  .map((l) => ({ a: l.a, by: cleanBy(l.by), at: isoOrEmpty(l.at) }));

export const logEntry = (a, by, at = new Date().toISOString()) => ({ a, by: { id: by?.id ?? null, name: by?.name || 'Someone' }, at });
export const withLog = (c, entry) => ({ ...c, log: [...(c.log || []), entry].slice(-MAX_LOG) });

// Anyone can reply, resolve, reopen or move a comment; only the person who wrote it can delete it.
export const canDeleteComment = (c, meId) => !!meId && !!c && !!c.by && c.by.id === meId;

const LOG_WORDS = { created: 'added the comment', replied: 'replied', resolved: 'resolved it', reopened: 'reopened it', moved: 'moved the pin' };
// The activity trail as shown: older comments without one still show who wrote them and when.
export function activity(c) {
  const log = (c.log && c.log.length ? c.log : [{ a: 'created', by: c.by, at: c.at }]);
  return log.map((l) => ({ text: `${l.by.name} ${LOG_WORDS[l.a]}`, at: l.at }));
}

export function cleanComments(list, uid) {
  const out = [];
  for (const c of (Array.isArray(list) ? list : []).slice(0, MAX_COMMENTS)) {
    if (!c || typeof c !== 'object' || !Number.isFinite(Number(c.x)) || !Number.isFinite(Number(c.y))) continue;
    const text = String(c.text ?? '').trim().slice(0, MAX_COMMENT_TEXT);
    if (!text) continue;
    const replies = [];
    for (const r of (Array.isArray(c.replies) ? c.replies : []).slice(0, MAX_REPLIES)) {
      const rt = String(r?.text ?? '').trim().slice(0, MAX_COMMENT_TEXT);
      if (rt) replies.push({ id: uid(r.id), text: rt, by: cleanBy(r.by), at: isoOrEmpty(r.at), tags: cleanTags(r.tags) });
    }
    out.push({
      id: uid(c.id), x: round2(clamp(Number(c.x), -COORD, COORD)), y: round2(clamp(Number(c.y), -COORD, COORD)),
      text, by: cleanBy(c.by), at: isoOrEmpty(c.at), tags: cleanTags(c.tags), done: !!c.done, replies, log: cleanLog(c.log),
    });
  }
  return out;
}

// ---- @ mentions while typing ------------------------------------------------

// Is the caret inside an "@query"? Returns { start, query } or null. The @ must start a word (so an email
// address does not count), and the query stays on one line and at most three words.
export function mentionQuery(text, caret) {
  const upto = String(text).slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && /[A-Za-z0-9_]/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (/[\n@]/.test(query) || query.length > 32 || query.trim().split(/\s+/).length > 3) return null;
  return { start: at, query };
}

const words = (s) => String(s).toLowerCase().split(/[\s._-]+/).filter(Boolean);

// People whose name (or the start of their email) matches what has been typed after the @.
// Best matches first: name starts with it, then a word in the name starts with it, then it appears anywhere.
export function filterPeople(people, query) {
  const q = String(query ?? '').trim().toLowerCase();
  const list = (people || []).filter((p) => p && p.id && p.name);
  if (!q) return [...list].sort((a, b) => a.name.localeCompare(b.name));
  const scored = [];
  for (const p of list) {
    const name = p.name.toLowerCase();
    const mail = String(p.email || '').toLowerCase().split('@')[0];
    let rank = -1;
    if (name.startsWith(q)) rank = 0;
    else if (words(name).some((w) => w.startsWith(q)) || (q.includes(' ') && name.includes(q))) rank = 1;
    else if (mail.startsWith(q)) rank = 2;
    else if (name.includes(q)) rank = 3;
    if (rank >= 0) scored.push([rank, p]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).map((x) => x[1]);
}

// Puts the chosen person in place of the "@query" at the caret.
export function applyMention(text, caret, person) {
  const q = mentionQuery(text, caret);
  if (!q) return { text, caret };
  const insert = `@${person.name} `;
  return { text: text.slice(0, q.start) + insert + text.slice(caret), caret: q.start + insert.length };
}

// Splits text into plain and tagged pieces: [{ s, tag?: person }]. A tag is "@" plus a person's full name.
export function segments(text, people) {
  const str = String(text ?? '');
  const byLen = [...(people || [])].filter((p) => p && p.id && p.name).sort((a, b) => b.name.length - a.name.length);
  const out = [];
  let plain = '';
  let i = 0;
  while (i < str.length) {
    let hit = null;
    if (str[i] === '@' && (i === 0 || !/[A-Za-z0-9_]/.test(str[i - 1]))) {
      for (const p of byLen) {
        const end = i + 1 + p.name.length;
        if (str.slice(i + 1, end).toLowerCase() === p.name.toLowerCase() && !/[A-Za-z0-9_]/.test(str[end] || ' ')) { hit = { p, end }; break; }
      }
    }
    if (hit) {
      if (plain) { out.push({ s: plain }); plain = ''; }
      out.push({ s: str.slice(i, hit.end), tag: hit.p });
      i = hit.end;
    } else { plain += str[i]; i += 1; }
  }
  if (plain) out.push({ s: plain });
  return out;
}

export function tagsFromText(text, people) {
  const seen = new Set();
  const tags = [];
  for (const seg of segments(text, people)) {
    if (seg.tag && !seen.has(seg.tag.id)) { seen.add(seg.tag.id); tags.push({ id: seg.tag.id, name: seg.tag.name }); }
  }
  return tags;
}

// ---- on the sketch -------------------------------------------------------------

// The pin is a bubble above the spot it marks. This finds the comment under a point (feet) at a zoom (pixels per foot).
export function hitComment(plan, x, y, scale) {
  const list = plan.comments || [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const c = list[i];
    const dx = x - c.x;
    const up = (c.y - y) * scale; // pixels above the spot
    if (Math.hypot(dx * scale, up - 15) <= 14 || (Math.abs(dx * scale) <= 5 && up >= 0 && up <= 15)) return c;
  }
  return null;
}

// A comment is aimed at a person when it, or a reply, tags them and it is still open.
export const mentionsPerson = (c, id) => !!id && !c.done && (c.tags.some((t) => t.id === id) || c.replies.some((r) => r.tags.some((t) => t.id === id)));

export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
