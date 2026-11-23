// PTO calendar (push 2A, #125). Time off is whole days, per person: a start date and an end date, both included.
// Pure rules for the Time off panel, the scheduler warning and the capacity count. Dates are 'YYYY-MM-DD' in the business time zone.
import { localDateStr, addDaysStr } from './booking.js';

export const MAX_NOTE = 200;
export const MAX_SPAN_DAYS = 120;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const days = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

// The add form: { staff_id, starts_on, ends_on, note } -> { error } or { value }.
export function cleanTimeOff(form) {
  if (!form?.staff_id) return { error: 'Pick who is off.' };
  const s = String(form.starts_on || '');
  const e = String(form.ends_on || form.starts_on || '');
  if (!DATE.test(s) || !DATE.test(e) || Number.isNaN(Date.parse(`${s}T12:00:00Z`)) || Number.isNaN(Date.parse(`${e}T12:00:00Z`))) return { error: 'Enter the first and last day off.' };
  if (e < s) return { error: 'The last day off cannot be before the first.' };
  if (days(s, e) + 1 > MAX_SPAN_DAYS) return { error: `Time off can be at most ${MAX_SPAN_DAYS} days at a time.` };
  return { value: { staff_id: form.staff_id, starts_on: s, ends_on: e, note: String(form.note || '').trim().slice(0, MAX_NOTE) } };
}

export const isOffOn = (entry, dateStr) => entry.starts_on <= dateStr && dateStr <= entry.ends_on;

// Entries (for one person, or everyone) that cover this date.
export const offOn = (entries, dateStr, staffId = null) => (entries || []).filter((x) => isOffOn(x, dateStr) && (!staffId || x.staff_id === staffId));

// Which date a visit starting at this moment falls on.
export const visitDate = (startsAt, tz) => localDateStr(new Date(startsAt).getTime(), tz);

// The same person cannot have two overlapping entries, which would only confuse the list.
export function overlapsExisting(entries, candidate, ignoreId = null) {
  return (entries || []).some((x) => x.id !== ignoreId && x.staff_id === candidate.staff_id && x.starts_on <= candidate.ends_on && candidate.starts_on <= x.ends_on);
}

// "Mon, Dec 1" or "Mon, Dec 1 to Fri, Dec 5"
export function rangeLabel(entry) {
  const f = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return entry.starts_on === entry.ends_on ? f(entry.starts_on) : `${f(entry.starts_on)} to ${f(entry.ends_on)}`;
}

// Crews available on a date when capacity mode is on: active techs minus those off that day. Never below zero.
export function crewsOn({ techIds = [], entries = [], dateStr }) {
  const off = new Set(offOn(entries, dateStr).map((x) => x.staff_id));
  return techIds.filter((id) => !off.has(id)).length;
}

export { addDaysStr };
