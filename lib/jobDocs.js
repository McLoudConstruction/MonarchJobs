// Shared constants and small pure helpers for job photos, sketches and updates.
// No imports, so it can be used by tests, pages and server routes alike.

export const PHOTO_BUCKET = 'job-photos';

export const PHOTO_KINDS = {
  before: 'Before',
  during: 'During',
  after: 'After',
  damage: 'Damage',
  other: 'Other',
};
export const PHOTO_KIND_KEYS = Object.keys(PHOTO_KINDS);

// Categories for internal notes. Free to extend: the database stores the text.
export const INTERNAL_CATEGORIES = [
  'General',
  'Initial inspection',
  'Moisture / drying',
  'Equipment',
  'Customer contact',
  'Insurance / adjuster',
  'Issue / concern',
  'Safety',
  'Completed work',
];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// File names in the private bucket. The database insert policy requires exactly these.
export const photoPaths = (jobId, photoId) => ({
  full: `${jobId}/${photoId}.jpg`,
  thumb: `${jobId}/${photoId}_t.jpg`,
});

// Size that fits inside a max x max box without enlarging.
export function fitWithin(width, height, max) {
  const s = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

export const photoKindLabel = (k) => PHOTO_KINDS[k] || 'Other';

// Counts of photos by kind, for the filter chips. Archived photos are not counted.
export function countByKind(photos) {
  const out = { all: 0 };
  for (const k of PHOTO_KIND_KEYS) out[k] = 0;
  for (const p of photos || []) {
    if (p.archived_at) continue;
    out.all += 1;
    out[p.kind] = (out[p.kind] || 0) + 1;
  }
  return out;
}

export function filterPhotos(photos, { kind = 'all', archived = false, roomKey = null } = {}) {
  return (photos || []).filter((p) => {
    if (!!p.archived_at !== !!archived) return false;
    if (kind !== 'all' && p.kind !== kind) return false;
    if (roomKey && p.room_key !== roomKey) return false;
    return true;
  });
}

// The time a photo was taken, when the browser can say so. Falls back to now for a missing,
// future or implausibly old value (some phones report 1970 for a file with no date).
export function takenAtFor(lastModified, now = Date.now()) {
  const t = Number(lastModified);
  const tenYears = 10 * 365 * 24 * 3600 * 1000;
  if (!Number.isFinite(t) || t > now + 60000 || t < now - tenYears) return new Date(now).toISOString();
  return new Date(t).toISOString();
}

// What a person sees in the History tab for the events these features write. Anything else keeps
// the old look (the event kind with underscores removed).
export function eventLabel(e) {
  const d = e.details || {};
  switch (e.kind) {
    case 'photos_added':
      return `added ${d.count || 1} photo${(d.count || 1) === 1 ? '' : 's'}${d.kind ? ` (${photoKindLabel(d.kind)})` : ''}`;
    case 'photo_archived': return 'archived a photo';
    case 'photo_restored': return 'restored a photo';
    case 'photo_markup': return 'saved a marked-up photo';
    case 'sketch_created': return `started sketch "${d.name || ''}"`.replace(' ""', '');
    case 'sketch_deleted': return `deleted sketch "${d.name || ''}"`.replace(' ""', '');
    case 'update_posted': return d.category ? `posted an internal update (${d.category})` : 'posted an internal update';
    case 'update_deleted': return d.kind === 'progress' ? 'deleted a progress update draft' : 'deleted an internal update';
    case 'progress_update_saved': return 'saved a progress update draft';
    case 'progress_update_sent': return d.manual ? 'marked a progress update as sent' : 'sent a progress update to the customer';
    default: return String(e.kind || '').replace(/_/g, ' ');
  }
}

// Wording for the text and email that carry a progress update link. Pure, so it can be tested.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function buildUpdateMessages({ business, customerName, link, jobNumber }) {
  const biz = (business || '').trim() || 'us';
  const first = String(customerName || '').trim().split(/\s+/)[0];
  const hello = first ? `Hi ${first}, ` : 'Hi, ';
  const ref = jobNumber ? ` on job #${jobNumber}` : '';
  const sms = `${hello}here is a progress update${ref} from ${biz}: ${link}`;
  const subject = `Progress update from ${biz}${jobNumber ? ` (job #${jobNumber})` : ''}`;
  const text = `${hello.replace(/, $/, ',')}\n\nWe have posted a progress update${ref}. You can read it, with photos, here:\n${link}\n\nIf you have questions, just reply or give us a call.\n\n${biz}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430;max-width:520px">
<p>${esc(hello.replace(/, $/, ','))}</p>
<p><strong>${esc(biz)}</strong> has posted a progress update${esc(ref)}. You can read it, with photos, online.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">View the update</a></p>
<p style="color:#6b7686;font-size:14px">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>
<p>If you have questions, just reply or give us a call.</p>
<p>${esc(biz)}</p></div>`;
  return { sms, subject, text, html };
}

// People who receive a progress update: the job's customer plus the job's extra contacts.
// A person appears once, even if their phone or email is on two records.
export function updateRecipients(customer, contacts) {
  const seenPhone = new Set();
  const seenEmail = new Set();
  const out = [];
  const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
  for (const c of [customer, ...(contacts || [])]) {
    if (!c) continue;
    const phone = digits(c.phone).length === 10 ? c.phone : '';
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c.email || '').trim()) ? String(c.email).trim() : '';
    const p = phone && !seenPhone.has(digits(phone)) ? phone : '';
    const m = email && !seenEmail.has(email.toLowerCase()) ? email : '';
    if (!p && !m) continue;
    if (p) seenPhone.add(digits(p));
    if (m) seenEmail.add(m.toLowerCase());
    out.push({ name: c.name || c.display_name || '', phone: p, email: m });
  }
  return out;
}
