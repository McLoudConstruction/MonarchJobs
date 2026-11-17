// The chat popup (desktop) and bottom sheet (phone): what shows in the list, in what order, which windows are open,
// and who can be messaged. Pure functions, no DOM, so they can be tested on their own.

import { personName } from './chat.js';

export const KIND_LABELS = { job: 'Job', lead: 'Lead', dm: 'Direct message', tech_line: 'Office line', channel: 'Channel' };

// How a row is shown. `label` from the database is already made for the reader.
export function rowDisplay(r, role) {
  const kind = r?.kind;
  let sub = KIND_LABELS[kind] || '';
  if (kind === 'tech_line') sub = role === 'tech' ? 'Owner and office' : 'Technician · shared with the office';
  if (kind === 'channel') sub = 'Everyone on staff';
  if (kind === 'dm') sub = 'Private';
  const initial = kind === 'channel' ? '#' : String(r?.label || '?').replace(/^#/, '').trim().charAt(0).toUpperCase() || '?';
  return { title: r?.label || 'Chat', sub, initial };
}

const waiting = (r) => (r.pending_acks || 0) > 0;
const unreadOf = (r) => (r.muted ? 0 : r.unread || 0);

// Needs-your-OK first, then a tech's own Office line, then unread, then the newest. Everything else keeps database order.
export function orderRows(rows, role) {
  const rank = (r) => {
    if (waiting(r)) return 0;
    if (role === 'tech' && r.kind === 'tech_line') return 1;
    if (unreadOf(r) > 0) return 2;
    return 3;
  };
  return [...(rows || [])]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || String(b.r.last_message_at).localeCompare(String(a.r.last_message_at)) || a.i - b.i)
    .map((x) => x.r);
}

export function filterRows(rows, { query = '', mode = 'all' } = {}) {
  const q = String(query).trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (mode === 'unread' && !(unreadOf(r) > 0 || waiting(r))) return false;
    if (mode === 'people' && !['dm', 'tech_line', 'channel'].includes(r.kind)) return false;
    if (mode === 'jobs' && !['job', 'lead'].includes(r.kind)) return false;
    if (!q) return true;
    return `${r.label || ''} ${r.last_preview || ''} ${r.last_author || ''}`.toLowerCase().includes(q);
  });
}

// The "new message" list. Anyone can message anyone. A tech reached by the office or owner opens the shared Office
// line for that tech by default (so the whole office sees it); `canPrivate` offers a private message instead.
export function peopleForPicker(staff, me) {
  const mine = me?.role;
  return (staff || [])
    .filter((s) => s && s.id && s.active !== false && s.id !== me?.id)
    .map((s) => {
      const toTech = s.role === 'tech' && mine !== 'tech';
      return { id: s.id, name: personName(s), role: s.role, action: toTech ? 'tech_line' : 'dm', canPrivate: toTech };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- open windows (desktop) ------------------------------------------------------

export const MAX_PILLS = 3;

// How many full windows fit beside the 340px list: each is about 340px with the gap.
export function maxExpandedFor(width) {
  const room = (Number(width) || 0) - 340 - 48;
  return Math.max(1, Math.min(3, Math.floor(room / 340)));
}

// windows: [{ threadId, title, href, minimized }] oldest first. Opening one puts it last (nearest the list) and
// open. When more are open than fit, the oldest open ones shrink to small tabs; the oldest tabs are dropped.
export function openWindow(windows, w, maxExpanded = 3) {
  const rest = (windows || []).filter((x) => x.threadId !== w.threadId);
  const prev = (windows || []).find((x) => x.threadId === w.threadId);
  let next = [...rest, { title: prev?.title, href: prev?.href, ...w, minimized: false }];
  const open = next.filter((x) => !x.minimized);
  for (let i = 0; i < open.length - maxExpanded; i++) open[i].minimized = true;
  const tabs = next.filter((x) => x.minimized);
  if (tabs.length > MAX_PILLS) {
    const drop = new Set(tabs.slice(0, tabs.length - MAX_PILLS).map((x) => x.threadId));
    next = next.filter((x) => !drop.has(x.threadId));
  }
  return next.map((x) => ({ ...x }));
}

export const closeWindow = (windows, threadId) => (windows || []).filter((x) => x.threadId !== threadId);
export const minimizeWindow = (windows, threadId) => (windows || []).map((x) => (x.threadId === threadId ? { ...x, minimized: true } : x));

// After the screen gets narrower, fewer fit: shrink the oldest open ones.
export function fitWindows(windows, maxExpanded) {
  let open = (windows || []).filter((x) => !x.minimized).length;
  return (windows || []).map((x) => {
    if (!x.minimized && open > maxExpanded) { open -= 1; return { ...x, minimized: true }; }
    return { ...x };
  });
}

export const serializeDock = (state) => JSON.stringify({
  v: 1,
  panel: !!state.panel,
  windows: (state.windows || []).slice(-6).map((w) => ({ threadId: w.threadId, title: String(w.title || '').slice(0, 80), href: w.href || null, minimized: !!w.minimized })),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseDock(text) {
  try {
    const d = JSON.parse(text);
    if (!d || d.v !== 1 || !Array.isArray(d.windows)) return { panel: false, windows: [] };
    return {
      panel: !!d.panel,
      windows: d.windows.filter((w) => w && UUID.test(String(w.threadId))).slice(-6).map((w) => ({ threadId: w.threadId, title: String(w.title || ''), href: typeof w.href === 'string' && w.href.startsWith('/') ? w.href : null, minimized: !!w.minimized })),
    };
  } catch { return { panel: false, windows: [] }; }
}

// ---- phones ----------------------------------------------------------------------

// The phone launcher bubble is hidden where the job button already carries chat (any job screen) and on the full
// conversation page.
export function bubbleHidden(pathname) {
  const p = String(pathname || '');
  return /^\/jobs\/[^/]+/.test(p) && p !== '/jobs/new' ? true : p.startsWith('/messages/');
}

// The unread number for the badge: threads you have not muted, plus changes waiting on your OK.
export function badgeText(n) {
  const c = Number(n) || 0;
  return c <= 0 ? '' : c > 99 ? '99+' : String(c);
}
