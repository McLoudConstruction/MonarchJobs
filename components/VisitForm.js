'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { fromLocalInput, toLocalInput } from '@/lib/format';
import { staffName } from '@/lib/userDisplay';
import { reasonsFor, reasonText, isFaultReason, needsReason, techsOnJob, defaultGobackTech, checkVisitReason, NOTE_MAX } from '@/lib/visitReasons';
import AppointmentPicker, { defaultAppointment } from '@/components/AppointmentPicker';
import { crewOf, planCrew } from '@/lib/visitCrew';

// Add a visit to a job, or reschedule / reassign an existing one (shown in a popup on the job screen). Pick a start time and a length
// (there is no end time), with the week's schedule alongside. Warns about double-booking and
// requires the office to confirm before saving over a conflict.
//
// Every visit after the first one on a job also asks why (a list of regular reasons, or Other with words). If the reason is the
// tech's failure, the visit is also logged as a go-back against that tech (migration 026, add_job_visit).
export default function VisitForm({ jobId, visit, visits = [], service = '', staffList, staff, onDone, onCancel, logEvent }) {
  const [appt, setAppt] = useState(() => (visit
    ? { start: toLocalInput(visit.starts_at), duration: visit.duration_minutes, techId: visit.tech_id || '', override: false }
    : defaultAppointment()));
  const [conflicts, setConflicts] = useState([]);
  // the rest of the crew: everyone else on this visit (an existing crew's other rows when rescheduling)
  const crewRows = useMemo(() => (visit ? crewOf(visit, visits).sort((a, b) => (a.id === (visit.crew_id || visit.id) ? -1 : b.id === (visit.crew_id || visit.id) ? 1 : 0)) : []), [visit, visits]);
  const [extras, setExtras] = useState(() => crewRows.filter((r) => r.id !== visit?.id && r.tech_id).map((r) => r.tech_id));
  const [extraConflicts, setExtraConflicts] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const asking = !visit && needsReason(visits);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [gobackChecked, setGobackChecked] = useState(false);
  const [gobackTech, setGobackTech] = useState(() => defaultGobackTech(visits));
  const fault = isFaultReason(reason) || (reason === 'other' && gobackChecked);
  // techs who have been on the job first, then everyone else
  const gobackChoices = useMemo(() => {
    const onJob = techsOnJob(visits);
    const rank = (id) => { const i = onJob.indexOf(id); return i < 0 ? 999 : i; };
    return [...staffList].sort((a, b) => rank(a.id) - rank(b.id) || staffName(a).localeCompare(staffName(b))).map((p) => ({ ...p, onJob: onJob.includes(p.id) }));
  }, [staffList, visits]);

  // team members who are already on another visit at this time (a heads-up; it does not block saving)
  const extraKey = extras.join(',');
  useEffect(() => {
    const start = appt.start ? new Date(appt.start) : null;
    if (!extras.length || !start || Number.isNaN(start.getTime()) || !(appt.duration > 0)) { setExtraConflicts([]); return undefined; }
    let live = true;
    const from = start.toISOString();
    const to = new Date(start.getTime() + appt.duration * 60000).toISOString();
    const own = new Set(crewRows.map((r) => r.id));
    getSupabase().from('job_visits').select('id,tech_id').in('tech_id', extras).in('status', ['scheduled', 'on_the_way', 'started']).lt('starts_at', to).gt('ends_at', from)
      .then(({ data }) => { if (live) setExtraConflicts([...new Set((data || []).filter((r) => !own.has(r.id)).map((r) => r.tech_id))]); });
    return () => { live = false; };
  }, [extraKey, appt.start, appt.duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const startedIds = new Set(crewRows.filter((r) => r.id !== visit?.id && r.status !== 'scheduled').map((r) => r.tech_id));
  const toggleExtra = (id) => setExtras((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const people = staffList.filter((p) => p.id !== appt.techId);
  const nameOf = (id) => { const p = staffList.find((x) => x.id === id); return p ? staffName(p) : 'Someone'; };

  // Rescheduling a crew: the lead's row was just updated; move everyone else to the same time, add new people, remove unticked ones.
  async function saveCrew(sb, row, crewIds) {
    const lead = crewRows.find((r) => r.id === (visit.crew_id || visit.id)) || visit;
    const rows = [lead, ...crewRows.filter((r) => r.id !== lead.id)];
    // the visit being edited might be a crew mate's row; the picker's person then is that row's person
    const leadTech = lead.id === visit.id ? row.tech_id : lead.tech_id;
    const plan = planCrew({ rows, leadTech, wanted: crewIds });
    const crewId = visit.crew_id || visit.id;
    const when = { starts_at: row.starts_at, duration_minutes: row.duration_minutes };
    if (!visit.crew_id && plan.add.length) {
      const r = await sb.from('job_visits').update({ crew_id: crewId }).eq('id', visit.id);
      if (r.error) return r.error;
    }
    const others = plan.keep.filter((r) => r.id !== visit.id && r.status === 'scheduled');
    if (others.length) {
      const r = await sb.from('job_visits').update(when).in('id', others.map((o) => o.id));
      if (r.error) return r.error;
    }
    if (plan.remove.length) {
      const r = await sb.from('job_visits').delete().in('id', plan.remove.map((o) => o.id));
      if (r.error) return r.error;
    }
    if (plan.add.length) {
      const r = await sb.from('job_visits').insert(plan.add.map((id) => ({ ...when, tech_id: id, job_id: jobId, created_by: staff.id, crew_id: crewId, reason: visit.reason || '', reason_note: visit.reason_note || '' })));
      if (r.error) return r.error;
    }
    return null;
  }

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    let why = null;
    if (asking) {
      const checked = checkVisitReason({ needed: true, reason, note, gobackChecked, gobackTech });
      if (checked.error) { setMsg(checked.error); return; }
      why = checked.value;
    }
    if (conflicts.length && !appt.override) { setMsg('Tick the box to book over the conflict, or pick another time or tech.'); return; }
    setBusy(true);
    const sb = getSupabase();
    const row = { tech_id: appt.techId || null, starts_at: fromLocalInput(appt.start), duration_minutes: appt.duration };
    const crewIds = [...new Set(extras.filter((id) => id && id !== row.tech_id))];
    let error;
    if (visit) {
      ({ error } = await sb.from('job_visits').update(row).eq('id', visit.id));
      if (!error && (crewRows.length > 1 || crewIds.length)) error = await saveCrew(sb, row, crewIds);
    } else if (why || crewIds.length) {
      // the visit, its go-back and the rest of the crew are saved together or not at all
      ({ error } = await sb.rpc('add_job_visit', {
        p_job: jobId, p_tech: row.tech_id, p_starts_at: row.starts_at, p_duration_minutes: row.duration_minutes,
        p_reason: why?.reason || '', p_reason_note: why?.reason_note || '', p_goback_tech: why?.goback_tech || null, p_extra_techs: crewIds,
      }));
      if (error && /add_job_visit|schema cache|PGRST202/i.test(error.message || '')) error = { message: crewIds.length ? 'Adding team members needs database update 027. Ask the owner to run it, then try again.' : 'Visit reasons need database update 026. Ask the owner to run it, then try again.' };
    } else {
      ({ error } = await sb.from('job_visits').insert({ ...row, job_id: jobId, created_by: staff.id }));
    }
    if (error) { setMsg(error.message); setBusy(false); return; }
    const text = why ? reasonText({ reason: why.reason, reason_note: why.reason_note }) : '';
    await logEvent(visit ? 'visit_rescheduled' : 'visit_added', {
      ...row,
      ...(crewIds.length ? { crew: crewIds } : {}),
      ...(why ? { reason: why.reason, reason_text: text } : {}),
      from: visit ? { tech_id: visit.tech_id, starts_at: visit.starts_at, duration_minutes: visit.duration_minutes } : undefined,
      override_double_booking: conflicts.length > 0,
    });
    if (why?.goback_tech) await logEvent('visit_goback', { tech_id: why.goback_tech, reason: why.reason, reason_text: text });
    setBusy(false);
    onDone();
  }

  return (
    <form onSubmit={save}>
      {asking && (
        <div className="visit-reason">
          <div className="field">
            <label htmlFor="vr-reason">Why is this visit needed?</label>
            <select id="vr-reason" value={reason} onChange={(e) => setReason(e.target.value)} required>
              <option value="">Choose a reason...</option>
              {reasonsFor(service).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          {reason === 'other' && (
            <div className="field">
              <label htmlFor="vr-note">What is the reason?</label>
              <input id="vr-note" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} required autoFocus />
            </div>
          )}
          {isFaultReason(reason) && (
            <div className="field">
              <label htmlFor="vr-detail">What went wrong? (optional)</label>
              <input id="vr-detail" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
          {reason === 'other' && (
            <label className="row" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={gobackChecked} onChange={(e) => setGobackChecked(e.target.checked)} /> This was the tech&rsquo;s fault (log a go-back)
            </label>
          )}
          {fault && (
            <div className="field">
              <label htmlFor="vr-tech">Log the go-back against</label>
              <select id="vr-tech" value={gobackTech} onChange={(e) => setGobackTech(e.target.value)} required>
                <option value="">Choose a tech...</option>
                {gobackChoices.map((p) => <option key={p.id} value={p.id}>{staffName(p)}{p.onJob ? ' (worked this job)' : ''}</option>)}
              </select>
              <div className="note">It is counted against them on the owner&rsquo;s Go-backs list. Other techs do not see it.</div>
            </div>
          )}
        </div>
      )}
      <AppointmentPicker value={appt} onChange={setAppt} staffList={staffList} excludeVisitId={visit?.id || null} onConflicts={setConflicts} />
      <div className="field visit-crew">
        <label>Also on this visit</label>
        <div className="visit-crew-list">
          {people.map((p) => (
            <label key={p.id} className={`visit-crew-chip ${extras.includes(p.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={extras.includes(p.id)} disabled={startedIds.has(p.id)} onChange={() => toggleExtra(p.id)} />
              {staffName(p)}
            </label>
          ))}
          {people.length === 0 && <span className="muted">No one else to add.</span>}
        </div>
        <div className="note">Each person gets the visit on their own schedule and clocks their own time. {startedIds.size > 0 && 'Anyone who has already started stays on the visit.'}</div>
        {extraConflicts.length > 0 && <div className="note" style={{ color: 'var(--warn, #b8741f)' }}>Already booked then: {extraConflicts.map(nameOf).join(', ')}. You can still save.</div>}
      </div>
      {msg && <div className="msg err">{msg}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" disabled={busy}>{busy ? 'Saving...' : visit ? 'Save changes' : 'Add visit'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
