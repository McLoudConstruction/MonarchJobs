'use client';

import { useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { fromLocalInput, toLocalInput } from '@/lib/format';
import AppointmentPicker, { defaultAppointment } from '@/components/AppointmentPicker';

// Add a visit to a job, or reschedule / reassign an existing one. Pick a start time and a length
// (there is no end time), with the week's schedule alongside. Warns about double-booking and
// requires the office to confirm before saving over a conflict.
export default function VisitForm({ jobId, visit, staffList, staff, onDone, onCancel, logEvent }) {
  const [appt, setAppt] = useState(() => (visit
    ? { start: toLocalInput(visit.starts_at), duration: visit.duration_minutes, techId: visit.tech_id || '', override: false }
    : defaultAppointment()));
  const [conflicts, setConflicts] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    if (conflicts.length && !appt.override) { setMsg('Tick the box to book over the conflict, or pick another time or tech.'); return; }
    setBusy(true);
    const sb = getSupabase();
    const row = { tech_id: appt.techId || null, starts_at: fromLocalInput(appt.start), duration_minutes: appt.duration };
    const { error } = visit
      ? await sb.from('job_visits').update(row).eq('id', visit.id)
      : await sb.from('job_visits').insert({ ...row, job_id: jobId, created_by: staff.id });
    if (error) { setMsg(error.message); setBusy(false); return; }
    await logEvent(visit ? 'visit_rescheduled' : 'visit_added', {
      ...row,
      from: visit ? { tech_id: visit.tech_id, starts_at: visit.starts_at, duration_minutes: visit.duration_minutes } : undefined,
      override_double_booking: conflicts.length > 0,
    });
    setBusy(false);
    onDone();
  }

  return (
    <form onSubmit={save} style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <AppointmentPicker value={appt} onChange={setAppt} staffList={staffList} excludeVisitId={visit?.id || null} onConflicts={setConflicts} />
      {msg && <div className="msg err">{msg}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" disabled={busy}>{busy ? 'Saving...' : visit ? 'Save changes' : 'Add visit'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
