// Estimate expiry for restoration estimates (push 1A, #12). The database sets expires_at when an estimate is sent
// (migration 040); this only reads it. An estimate is valid through the whole last day in the business time zone,
// so expires_at is the start of the day after.
import { dateInTz } from './outreach.js';

export function isExpired(estimate, now = new Date()) {
  if (!estimate || estimate.status !== 'sent' || !estimate.expires_at) return false;
  return new Date(estimate.expires_at) <= now;
}

// 'YYYY-MM-DD' of the last day the estimate can be approved, or null when it does not expire.
export function validThrough(expiresAt, tz = 'America/Chicago') {
  if (!expiresAt) return null;
  return dateInTz(new Date(new Date(expiresAt).getTime() - 1000), tz);
}

// Whole days left including today (0 = expired), or null when it does not expire.
export function daysLeft(expiresAt, now = new Date(), tz = 'America/Chicago') {
  if (!expiresAt) return null;
  if (new Date(expiresAt) <= now) return 0;
  const last = validThrough(expiresAt, tz);
  const today = dateInTz(now, tz);
  const ms = Date.parse(`${last}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// '2026-12-01' -> 'Dec 1, 2026'
export function prettyDay(ymd) {
  if (!ymd) return '';
  const [y, m, d] = String(ymd).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// What the office sees under the estimate status: [text, tone] or null.
export function expiryNote(estimate, now = new Date(), tz = 'America/Chicago') {
  if (!estimate || estimate.status !== 'sent' || !estimate.expires_at) return null;
  const through = prettyDay(validThrough(estimate.expires_at, tz));
  if (isExpired(estimate, now)) return [`Expired. It was valid through ${through}.`, 'flag'];
  const left = daysLeft(estimate.expires_at, now, tz);
  return [`Valid through ${through} (${left} ${left === 1 ? 'day' : 'days'} left).`, left <= 3 ? 'flag' : 'info'];
}
