// Server only. Writes the job clock with the service role (the browser can only read it; see migration 024).
// Everything here is best effort around the visit buttons: a clock problem must never stop a tech from tapping Start or Finish,
// so the callers wrap these in try/catch.
import { clockStepFor, sessionHours } from './jobClock.js';
import { serviceOf } from './services.js';

// The person's running session on a job, or null.
export async function openSessionFor(admin, jobId, staffId) {
  const { data } = await admin.from('job_clock_sessions').select('*').eq('job_id', jobId).eq('staff_id', staffId).is('ended_at', null).is('voided_at', null).maybeSingle();
  return data || null;
}

// Keeps the owner's costing ledger (job_time_entries) in step with a session: one entry per finished session, at the person's
// hourly cost when the clock stopped (kept if the entry already exists, so a later rate change never rewrites old hours).
// A session of under half a minute, or a voided one, has no live entry.
export async function syncLedgerEntry(admin, session) {
  const { data: entry } = await admin.from('job_time_entries').select('id,rate_cents,voided_at').eq('clock_session_id', session.id).maybeSingle();
  const hours = session.voided_at ? 0 : sessionHours(session);
  const workedOn = new Date(session.started_at).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  if (entry) {
    if (hours > 0) return admin.from('job_time_entries').update({ hours, worked_on: workedOn, voided_at: null, void_reason: '' }).eq('id', entry.id);
    return admin.from('job_time_entries').update({ voided_at: entry.voided_at || new Date().toISOString(), void_reason: session.voided_at ? 'Clock entry removed' : 'Clock entry under a minute' }).eq('id', entry.id);
  }
  if (!(hours > 0) || !session.ended_at) return null;
  const [{ data: rate }, { data: person }] = await Promise.all([
    admin.from('staff_cost_rates').select('hourly_cents').eq('staff_id', session.staff_id).maybeSingle(),
    admin.from('staff_users').select('full_name,email').eq('id', session.staff_id).maybeSingle(),
  ]);
  return admin.from('job_time_entries').insert({
    job_id: session.job_id, staff_id: session.staff_id,
    worker_name: String(person?.full_name || person?.email || '').slice(0, 80),
    worked_on: workedOn, hours, rate_cents: rate?.hourly_cents || 0, note: 'From the job clock', clock_session_id: session.id,
    created_by: null,
  });
}

export async function openSession(admin, { jobId, visitId = null, staffId, at, source = 'visit' }) {
  const { data, error } = await admin.from('job_clock_sessions').insert({ job_id: jobId, visit_id: visitId, staff_id: staffId, started_at: new Date(at).toISOString(), source }).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function closeSession(admin, session, at) {
  let end = new Date(at);
  if (!(end > new Date(session.started_at))) end = new Date(new Date(session.started_at).getTime() + 1000); // never zero or negative
  const { data, error } = await admin.from('job_clock_sessions').update({ ended_at: end.toISOString() }).eq('id', session.id).is('ended_at', null).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (data) await syncLedgerEntry(admin, data);
  return data;
}

// What a visit button does to the clock (On the way / Start job / Finish job). `when` is the time the tap really happened.
export async function applyClockForVisit(admin, { visit, action, when }) {
  if (!visit?.tech_id) return null; // no one to clock
  const { data: job } = await admin.from('jobs').select('id,service,job_type').eq('id', visit.job_id).maybeSingle();
  if (!job) return null;
  const open = await openSessionFor(admin, job.id, visit.tech_id);
  const step = clockStepFor({ service: serviceOf(job), action, open: !!open });
  if (step === 'open') return openSession(admin, { jobId: job.id, visitId: visit.id, staffId: visit.tech_id, at: when });
  if (step === 'arrive') {
    if (!open.arrived_at) await admin.from('job_clock_sessions').update({ arrived_at: new Date(when).toISOString() }).eq('id', open.id);
    return open;
  }
  if (step === 'close') return closeSession(admin, open, when);
  return null;
}
