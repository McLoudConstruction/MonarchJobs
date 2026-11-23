// Requests from the team: time off, and on-call swaps. Pure rules for the Time page (tech) and the review lists (owner).
// The database (migration 049) decides who may approve; this only checks what a person typed and words the status.
import { cleanTimeOff, MAX_NOTE } from './timeOff.js';
import { upcomingWeeks } from './onCall.js';

export const STATUS_TEXT = { pending: 'Waiting for review', approved: 'Approved', declined: 'Not approved' };

// { starts_on, ends_on, note } for the signed-in person -> { error } or { value }
export function cleanTimeOffRequest(form, staffId, todayStr) {
  const c = cleanTimeOff({ ...form, staff_id: staffId });
  if (c.error) return c;
  if (todayStr && c.value.ends_on < todayStr) return { error: 'Those days have already passed.' };
  const { staff_id: _ignored, ...rest } = c.value;
  return { value: { staff_id: staffId, ...rest } };
}

// { from, to (ISO times), cover_id, note } -> { error } or { value }. now: a Date.
export function cleanSwapRequest(form, staffId, now = new Date()) {
  const a = new Date(form?.from); const b = new Date(form?.to);
  if (!form?.from || !form?.to || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return { error: 'Pick when the swap starts and ends.' };
  if (b <= a) return { error: 'The swap must end after it starts.' };
  if (b <= now) return { error: 'That time has already passed.' };
  if (b - a > 60 * 86400000) return { error: 'A swap can be up to 60 days.' };
  if (form.cover_id && form.cover_id === staffId) return { error: 'Pick someone else to cover, or leave it blank.' };
  return { value: { requester_id: staffId, starts_at: a.toISOString(), ends_at: b.toISOString(), cover_id: form.cover_id || null, note: String(form.note || '').trim().slice(0, MAX_NOTE) } };
}

// The weeks this person is on call, from now: [{ weekStart, startsAt, endsAt }]. cfg: the rotation settings (see lib/onCall.js).
export function myOnCallWeeks(staffId, cfg, count = 12, fromMs = Date.now()) {
  const span = Math.max(1, (cfg.oncall_order || []).length) * count + 2; // far enough ahead to reach `count` of this person's weeks
  const weeks = upcomingWeeks(fromMs - 7 * 86400000, span, cfg);
  const out = [];
  for (let i = 0; i < weeks.length; i += 1) {
    const w = weeks[i];
    const endsAt = i + 1 < weeks.length ? weeks[i + 1].startsAt : w.startsAt + 7 * 86400000;
    if (w.staffId === staffId && endsAt > fromMs) out.push({ weekStart: w.weekStart, startsAt: w.startsAt, endsAt });
  }
  return out.slice(0, count);
}
