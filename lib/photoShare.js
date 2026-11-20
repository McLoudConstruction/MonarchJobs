// Customer photo share links and bulk "add to update". Pure helpers, so the tab, the public route and the tests agree.
export const SHARE_MAX_PHOTOS = 60;
export const UPDATE_MAX_PHOTOS = 40; // job_updates.photo_ids limit
export const SHARE_DAYS = [7, 30, 90];

// Add picked photo ids to an update's list: keep the update's order, skip repeats, stop at the limit.
export function addPhotosToUpdate(existing, picked, max = UPDATE_MAX_PHOTOS) {
  const ids = [...(existing || [])];
  const have = new Set(ids);
  let added = 0; let skipped = 0; let full = 0;
  for (const id of picked || []) {
    if (have.has(id)) { skipped += 1; continue; }
    if (ids.length >= max) { full += 1; continue; }
    ids.push(id); have.add(id); added += 1;
  }
  return { ids, added, skipped, full };
}

export function addToUpdateText({ added, skipped, full }, max = UPDATE_MAX_PHOTOS) {
  const bits = [];
  bits.push(added ? `Added ${added} ${added === 1 ? 'photo' : 'photos'} to the update.` : 'Nothing new to add.');
  if (skipped) bits.push(`${skipped} ${skipped === 1 ? 'was' : 'were'} already in it.`);
  if (full) bits.push(`${full} did not fit: an update holds ${max} photos.`);
  return bits.join(' ');
}

// Only pictures that are on this job and not archived, in the order picked, capped.
export function sharablePhotoIds(picked, photos) {
  const ok = new Map((photos || []).filter((p) => !p._local && !p.archived_at).map((p) => [p.id, p]));
  return [...new Set(picked || [])].filter((id) => ok.has(id)).slice(0, SHARE_MAX_PHOTOS);
}

export const expiryFromDays = (days, now = Date.now()) => new Date(now + Math.max(1, Number(days) || 30) * 86400000).toISOString();

// 'live' | 'off' | 'expired'
export function shareState(s, now = Date.now()) {
  if (!s) return 'off';
  if (s.revoked_at) return 'off';
  if (new Date(s.expires_at).getTime() <= now) return 'expired';
  return 'live';
}
export const shareStateText = (state) => ({ live: 'On', off: 'Switched off', expired: 'Expired' }[state] || '');

export const shareUrl = (base, token) => `${String(base || '').replace(/\/$/, '')}/p/${token}`;

// What a customer may see of a photo: the picture and (if the office allows) its caption. Never location, tags, who took it, or a voice note.
export function publicPhoto(p, { showCaptions, url, thumbUrl }) {
  return { id: p.id, caption: showCaptions ? (p.caption || '') : '', taken_on: p.taken_at ? String(p.taken_at).slice(0, 10) : null, url, thumb_url: thumbUrl || url };
}
