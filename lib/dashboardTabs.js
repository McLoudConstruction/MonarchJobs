import { isPastDue, todayIn } from './invoice.js';

// The Dashboard is one page with tabs: Today, Activity, Invoices and Owner. Which tabs a person
// sees depends on their role, the same rule the separate pages used to follow.
const ALL = ['owner', 'office', 'tech'];
const OFFICE = ['owner', 'office'];

export const TAB_DEFS = [
  { key: 'today', label: 'Today', roles: ALL },
  { key: 'activity', label: 'Activity', roles: ALL },
  { key: 'invoices', label: 'Invoices', roles: OFFICE },
  { key: 'owner', label: 'Owner', roles: ['owner'] },
];

export function tabsFor(role) {
  return TAB_DEFS
    .filter((t) => t.roles.includes(role))
    .map((t) => (t.key === 'today' && role === 'tech' ? { ...t, label: 'My day' } : t));
}

// "?tab=invoices" -> 'invoices'. Unknown tabs, or tabs this role may not open, land on Today.
export function parseTab(search, role) {
  const key = new URLSearchParams(search || '').get('tab');
  return tabsFor(role).some((t) => t.key === key) ? key : 'today';
}

// Where a tab lives. `hash` keeps a tab's own sub-view, like #messages inside Activity.
export function tabHref(key, hash = '') {
  const h = hash && hash !== '#' ? (hash.startsWith('#') ? hash : `#${hash}`) : '';
  return key === 'today' || !key ? `/dashboard${h}` : `/dashboard?tab=${key}${h}`;
}

// Invoices that need the office: how many are past due and how many drafts are still unsent.
export function invoiceFlagCounts(rows, today = todayIn()) {
  let pastDue = 0;
  let pastDueCents = 0;
  let drafts = 0;
  for (const i of rows || []) {
    if (i.status === 'draft') drafts += 1;
    else if (isPastDue(i, today)) { pastDue += 1; pastDueCents += Number(i.balance_cents) || 0; }
  }
  return { pastDue, pastDueCents, drafts };
}

// What the Invoices tab shows: past due in red, otherwise drafts waiting to be sent in a quieter tone.
export function invoiceBadge({ pastDue = 0, drafts = 0 } = {}) {
  if (pastDue > 0) return { count: pastDue, tone: 'bad', title: `${pastDue} past due` };
  if (drafts > 0) return { count: drafts, tone: 'warn', title: `${drafts} draft${drafts === 1 ? '' : 's'} not sent` };
  return null;
}

// The one number on the Dashboard link in the main menu: unread activity plus past-due invoices.
// Red as soon as anything is past due, so money problems cannot hide behind routine alerts.
export function dashboardBadge({ activity = 0, pastDue = 0 } = {}) {
  const count = (activity || 0) + (pastDue || 0);
  if (count <= 0) return null;
  const parts = [];
  if (activity > 0) parts.push(`${activity} unread in Activity`);
  if (pastDue > 0) parts.push(`${pastDue} past-due invoice${pastDue === 1 ? '' : 's'}`);
  return { count, tone: pastDue > 0 ? 'bad' : 'accent', title: parts.join(', ') };
}
