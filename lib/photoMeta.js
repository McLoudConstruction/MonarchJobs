// Small pure helpers for photo details: tags, location, the duplicate check, whether to keep a full-size original, and
// how the Photos tab lists and filters pictures (including pictures still waiting on the phone). No imports, so tests,
// pages and server routes can all use it.

export const MAX_TAGS = 20;
export const MAX_TAG_LEN = 30;
export const ORIGINAL_MAX_BYTES = 14 * 1024 * 1024; // the photo bucket refuses files over 15 MB
const ORIGINAL_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// ------------------------------------------------------------------ tags
export const cleanTag = (s) => String(s ?? '').replace(/[#,;]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LEN);

// One list, no blanks, no repeats (Water and water are the same tag; the first spelling wins), at most MAX_TAGS.
export function cleanTags(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const t = cleanTag(raw);
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
export const addTag = (tags, tag) => cleanTags([...(tags || []), tag]);
export const removeTag = (tags, tag) => (tags || []).filter((t) => t.toLowerCase() !== String(tag).toLowerCase());

// Every tag used on live (not archived) photos, most used first: [{ tag, count }]
export function tagCounts(photos) {
  const map = new Map();
  for (const p of photos || []) {
    if (p.archived_at) continue;
    for (const t of p.tags || []) {
      const k = t.toLowerCase();
      const cur = map.get(k);
      if (cur) cur.count += 1; else map.set(k, { tag: t, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// ------------------------------------------------------------------ location
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

// A browser GeolocationPosition (or anything shaped like one) -> { lat, lng, accuracy, at } or null.
export function gpsFromPosition(pos) {
  const c = pos && pos.coords;
  if (!c) return null;
  const lat = Number(c.latitude);
  const lng = Number(c.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null; // "null island": a phone with no real fix
  const acc = Number(c.accuracy);
  return { lat: round(lat, 6), lng: round(lng, 6), accuracy: Number.isFinite(acc) && acc >= 0 ? round(acc, 1) : null, at: Number(pos.timestamp) || Date.now() };
}

// The latest fix, if it is recent enough to still describe where the person is standing.
export function freshGps(fix, now = Date.now(), maxAgeMs = 3 * 60 * 1000) {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return null;
  if (now - (fix.at || 0) > maxAgeMs) return null;
  return { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy ?? null };
}

export const mapsUrl = (lat, lng) => `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;

// ------------------------------------------------------------------ duplicates
export const hexOf = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// sha-256 of a Blob / File / ArrayBuffer as 64 hex characters, or null when this browser cannot (not a secure page).
export async function sha256Hex(data) {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const buf = data && typeof data.arrayBuffer === 'function' ? await data.arrayBuffer() : data;
    return hexOf(await subtle.digest('SHA-256', buf));
  } catch { return null; }
}

// hashes already on the job: server rows plus pictures still waiting on the phone
export function knownHashes(photos, waiting = []) {
  const set = new Set();
  for (const p of photos || []) if (p.content_hash && !p.archived_at) set.add(p.content_hash);
  for (const w of waiting || []) if (w.contentHash && w.state !== 'cancelled') set.add(w.contentHash);
  return set;
}

// ------------------------------------------------------------------ originals
// Keep the full-size original only when the owner turned it on, the server will take the file, and it adds something
// (it is clearly bigger than the web copy).
export function shouldKeepOriginal({ keep, size, type, webSize }) {
  if (!keep) return false;
  if (!ORIGINAL_TYPES.includes(String(type || '').toLowerCase())) return false;
  if (!(size > 0) || size > ORIGINAL_MAX_BYTES) return false;
  return size > (webSize || 0) * 1.25;
}

// ------------------------------------------------------------------ rooms
export const photoRoomValue = (p) => (p && p.sketch_id && p.room_key ? `${p.sketch_id}|${p.room_key}` : '');
export function splitRoomValue(v) {
  const [sketchId, roomKey] = String(v || '').split('|');
  return sketchId && roomKey ? { sketchId, roomKey } : null;
}

// ------------------------------------------------------------------ the Photos tab list
// Pictures still on the phone appear in the same grid, dimmed, so a photo never seems to vanish between the shutter and
// the server. waiting: [{ id, jobId, kind, caption, roomKey, sketchId, takenAt, state, lastError, attempts, url, tags }]
export function mergeWaiting(photos, waiting) {
  const have = new Set((photos || []).map((p) => p.id));
  const local = (waiting || [])
    .filter((w) => !have.has(w.id) && w.state !== 'cancelled')
    .map((w) => ({
      id: w.id, _local: true, state: w.state, kind: w.kind, caption: w.caption || '', taken_at: w.takenAt, thumbUrl: w.url,
      sketch_id: w.sketchId || null, room_key: w.roomKey || null, tags: w.tags || [], lastError: w.lastError || '', attempts: w.attempts || 0,
      created_by: null, archived_at: null,
    }));
  return [...(photos || []), ...local];
}

// The words shown on a picture that has not reached the server yet.
export function localStatus(item) {
  if (item.state === 'blocked') return { key: 'blocked', label: 'Needs attention' };
  if (item.attempts > 0) return { key: 'waiting', label: 'Waiting for signal' };
  return { key: 'sending', label: 'Sending' };
}

// Filters for the Photos tab. kind/roomValue/tag/who are 'all' or null for "no filter". roomValue 'none' = not linked to a room.
export function filterGrid(items, { kind = 'all', roomValue = null, tag = null, who = null, archived = false } = {}) {
  return (items || []).filter((p) => {
    if (!!p.archived_at !== !!archived) return false;
    if (kind && kind !== 'all' && p.kind !== kind) return false;
    if (roomValue === 'none' && photoRoomValue(p)) return false;
    if (roomValue && roomValue !== 'none' && photoRoomValue(p) !== roomValue) return false;
    if (tag && !(p.tags || []).some((t) => t.toLowerCase() === String(tag).toLowerCase())) return false;
    if (who && p.created_by !== who && !(p._local && who === 'me')) return false;
    return true;
  });
}

// counts for the room chips: { value, label, count } for rooms that have photos, in the order of `rooms`
export function roomCounts(items, rooms) {
  const counts = new Map();
  let none = 0;
  for (const p of items || []) {
    if (p.archived_at) continue;
    const v = photoRoomValue(p);
    if (v) counts.set(v, (counts.get(v) || 0) + 1); else none += 1;
  }
  const out = (rooms || []).filter((r) => counts.has(r.value)).map((r) => ({ value: r.value, label: r.label, count: counts.get(r.value) }));
  // a photo whose room was removed from the sketch still shows under its own chip
  for (const [v, count] of counts) if (!out.some((o) => o.value === v)) out.push({ value: v, label: 'Removed room', count });
  return { rooms: out, none };
}
