// Why a visit is being added. The first visit on a job needs no reason; every later one does (it is usually a second trip), picked from
// this list or typed under "Other". Reasons that are the tech's failure (missed an area, redo, forgot equipment) are also logged as a
// go-back against that tech (table job_gobacks, migration 026). Pure, so the form, the screens and the tests agree.
//
// `fault` marks the reasons that are always a go-back. `only` limits a reason to some services (no list = every service).
export const VISIT_REASONS = [
  { key: 'unfinished', label: 'Could not finish in one visit' },
  { key: 'added_scope', label: 'More work added' },
  { key: 'customer_request', label: 'Customer asked us back' },
  { key: 'recheck', label: 'Moisture recheck', only: ['mitigation'] },
  { key: 'equipment_pickup', label: 'Pick up equipment', only: ['extraction', 'mitigation', 'remediation'] },
  { key: 'materials', label: 'Waiting on materials or parts' },
  { key: 'no_access', label: 'No access, customer not home' },
  { key: 'spots_returned', label: 'Spots came back, re-clean', only: ['carpet'] },
  { key: 'tech_missed', label: 'Missed an area or left work unfinished', fault: true },
  { key: 'tech_redo', label: 'Work not up to standard, redo', fault: true },
  { key: 'tech_forgot', label: 'Forgot equipment or supplies', fault: true },
  { key: 'other', label: 'Other' },
];

export const NOTE_MAX = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const byKey = Object.fromEntries(VISIT_REASONS.map((r) => [r.key, r]));

// The reasons offered on a job with this service (a job with no service gets them all).
export function reasonsFor(service) {
  return VISIT_REASONS.filter((r) => !r.only || !service || r.only.includes(service));
}

export const isKnownReason = (key) => !!byKey[key];
export const isFaultReason = (key) => !!byKey[key]?.fault;

// "Missed an area or left work unfinished", or "Other: waiting on the adjuster" for a typed reason. '' when there is none.
export function reasonText(visit) {
  const key = visit?.reason || '';
  if (!key) return '';
  const label = byKey[key]?.label || '';
  const note = String(visit?.reason_note || '').trim();
  if (key === 'other') return note ? `Other: ${note}` : 'Other';
  return label;
}

// Visits that count when asking "is this a later visit?": everything but cancelled ones.
export const liveVisits = (visits) => (visits || []).filter((v) => v.status !== 'cancelled');
export const needsReason = (visits) => liveVisits(visits).length > 0;

// The techs who have been on the job, most recent first (so the likeliest one is on top of the go-back pick list).
export function techsOnJob(visits) {
  const seen = new Set();
  const out = [];
  for (const v of [...liveVisits(visits)].sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)))) {
    if (v.tech_id && !seen.has(v.tech_id)) { seen.add(v.tech_id); out.push(v.tech_id); }
  }
  return out;
}

// Who a go-back most likely belongs to: the tech on the latest visit that actually happened, else the latest one booked.
export function defaultGobackTech(visits) {
  const live = [...liveVisits(visits)].filter((v) => v.tech_id).sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)));
  const happened = live.find((v) => ['started', 'finished'].includes(v.status));
  return (happened || live[0])?.tech_id || '';
}

// Checks the reason part of the Add visit form. `needed` is false for the first visit on a job (nothing to ask).
// `gobackChecked` is the "this was the tech's fault" tick shown under Other. Returns { error } or { value }.
export function checkVisitReason({ needed = true, reason = '', note = '', gobackChecked = false, gobackTech = '' } = {}) {
  if (!needed) return { value: { reason: '', reason_note: '', goback_tech: null } };
  const key = String(reason || '');
  if (!byKey[key]) return { error: 'Pick a reason for this visit.' };
  const text = String(note || '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  if (key === 'other' && text.length < 3) return { error: 'Say what the reason is.' };
  const fault = byKey[key].fault || (key === 'other' && !!gobackChecked);
  if (!fault) return { value: { reason: key, reason_note: text, goback_tech: null } };
  if (!UUID.test(String(gobackTech || ''))) return { error: 'Pick the tech this go-back is logged against.' };
  return { value: { reason: key, reason_note: text, goback_tech: gobackTech } };
}

// Go-backs per tech, most first. rows: [{ tech_id, voided_at? }] (voided ones are skipped).
export function gobackCounts(rows) {
  const n = new Map();
  for (const r of rows || []) { if (!r.voided_at && r.tech_id) n.set(r.tech_id, (n.get(r.tech_id) || 0) + 1); }
  return [...n.entries()].map(([techId, count]) => ({ techId, count })).sort((a, b) => b.count - a.count);
}
