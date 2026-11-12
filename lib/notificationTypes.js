// Every kind of in-app notification, who it is for, and how it is shown. The `type` keys are the
// same strings the database triggers write (supabase/migrations/010_notifications.sql).
//
// tier: action = someone needs to do something, info = heads-up, alert = something changed or went wrong.
// grouped: repeated changes are folded into one row, so the list shows "x3".

export const TIERS = {
  action: { label: 'Needs action' },
  info: { label: 'Heads-up' },
  alert: { label: 'Alert' },
};

const OFFICE = ['owner', 'office'];

export const NOTIFICATION_TYPES = {
  // ---- owner and office
  new_lead: { label: 'New lead', roles: OFFICE, group: 'Leads', hint: 'A lead came in by phone, web form or manual entry. Emergency leads show as alerts.' },
  estimate_approved: { label: 'Estimate approved', roles: OFFICE, group: 'Leads', hint: 'A customer signed the estimate and is ready to be scheduled.' },
  estimate_viewed: { label: 'Estimate viewed', roles: OFFICE, group: 'Leads', hint: 'The first time a customer opens an estimate.' },
  progress_draft: { label: 'Progress update waiting', roles: OFFICE, group: 'Jobs', hint: 'A tech saved a customer update that needs to be reviewed and sent.' },
  tech_on_the_way: { label: 'Tech on the way', roles: OFFICE, group: 'Jobs', hint: 'A tech tapped "On the way", with the minutes.' },
  job_started: { label: 'Job started', roles: OFFICE, group: 'Jobs', hint: 'A tech started a job.' },
  visit_finished: { label: 'Visit finished', roles: OFFICE, group: 'Jobs', hint: 'A visit finished but another visit is still scheduled.' },
  job_completed: { label: 'Job completed', roles: OFFICE, group: 'Jobs', hint: 'The last visit on a job finished.' },
  scope_changed: { label: 'Tech changed scope or price', roles: OFFICE, group: 'Jobs', grouped: true, hint: 'A tech added, changed or removed an estimate line. Grouped per job.' },
  double_booking: { label: 'Double-booking override', roles: OFFICE, group: 'Schedule', hint: 'Someone booked a tech over another job.' },
  // ---- owner only
  staff_signup: { label: 'New sign-up', roles: ['owner'], group: 'Team', hint: 'A new account is waiting to be activated in Settings > Users.' },
  // ---- technicians
  visit_assigned: { label: 'New visit assigned', roles: ['tech'], group: 'My schedule', hint: 'You were scheduled on a visit, with the loss summary.' },
  visit_changed: { label: 'Visit moved, removed or cancelled', roles: ['tech'], group: 'My schedule', hint: 'A visit you were on changed.' },
  visit_reminder: { label: 'Visit starts in about an hour', roles: ['tech'], group: 'My schedule', hint: 'A reminder shortly before a scheduled visit.' },
  day_summary: { label: 'Tomorrow’s schedule', roles: ['tech'], group: 'My schedule', hint: 'Sent around 6 pm with tomorrow’s visit count.' },
  job_info_changed: { label: 'Job details changed', roles: ['tech'], group: 'My jobs', grouped: true, hint: 'Warning, loss summary, notes or address changed on a job you are scheduled on.' },
  job_scope_updated: { label: 'Scope or price updated', roles: ['tech'], group: 'My jobs', grouped: true, hint: 'Someone else changed the estimate on your job.' },
};

export function typesForRole(role) {
  return Object.entries(NOTIFICATION_TYPES)
    .filter(([, t]) => t.roles.includes(role))
    .map(([key, t]) => ({ key, ...t }));
}

// [{ group, types: [...] }] in the order groups first appear.
export function groupedTypesForRole(role) {
  const out = [];
  for (const t of typesForRole(role)) {
    let g = out.find((x) => x.group === t.group);
    if (!g) { g = { group: t.group, types: [] }; out.push(g); }
    g.types.push(t);
  }
  return out;
}

// Preference rows only exist for types someone turned off; no row means on.
export function isTypeEnabled(prefs, type) {
  return !(prefs && prefs[type] === false);
}

// A notification's url is a path that may end in #tab. Compare on the path only.
export function urlPath(url) {
  return String(url || '').split('#')[0].split('?')[0];
}

// Unread, still-open notifications are what the badge counts.
export function badgeCount(list) {
  return (list || []).filter((n) => !n.read_at && !n.resolved_at).length;
}

// "3 min ago", "Yesterday", "Nov 9"
export function timeAgo(iso, now = new Date()) {
  const d = new Date(iso);
  const secs = Math.max(0, Math.round((now - d) / 1000));
  if (secs < 60) return 'Just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
