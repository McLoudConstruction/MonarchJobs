'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { fromLocalInput, toLocalInput, fmtDateTime } from '@/lib/format';

// Add a visit to a job, or reschedule / reassign an existing one. Warns about double-booking
// and requires the office to confirm before saving over a conflict.
export default function VisitForm({ jobId, visit, staffList, staff, onDone, onCancel, logEvent }) {
  const base = new Date();
  base.setMinutes(0, 0, 0);
  base.setHours(base.getHours() + 1);
  const [start, setStart] = useState(toLocalInput(visit ? visit.starts_at : base));
  const [end, setEnd] = useState(toLocalInput(visit ? visit.ends_at : new Date(base.getTime() + 2 * 3600 * 1000)));
  const [techId, setTechId] = useState(visit?.tech_id || '');
  const [conflicts, setConflicts] = useState([]);
  const [override, setOverride] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOverride(false);
    if (!techId || !start || !end || new Date(end) <= new Date(start)) { setConflicts([]); return; }
    let q = getSupabase().from('job_visits')
      .select('id,starts_at,ends_at,job:jobs(job_number,customer:customers(display_name))')
      .eq('tech_id', techId).in('status', ['scheduled', 'on_the_way', 'started'])
      .lt('starts_at', fromLocalInput(end)).gt('ends_at', fromLocalInput(start));
    if (visit?.id) q = q.neq('id', visit.id);
    q.then(({ data }) => setConflicts(data || []));
  }, [techId, start, end, visit?.id]);

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    if (new Date(end) <= new Date(start)) { setMsg('End time must be after the start time.'); return; }
    if (conflicts.length && !override) { setMsg('Tick the box to book over the conflict, or pick another time or tech.'); return; }
    setBusy(true);
    const sb = getSupabase();
    const row = { tech_id: techId || null, starts_at: fromLocalInput(start), ends_at: fromLocalInput(end) };
    const { error } = visit
      ? await sb.from('job_visits').update(row).eq('id', visit.id)
      : await sb.from('job_visits').insert({ ...row, job_id: jobId, created_by: staff.id });
    if (error) { setMsg(error.message); setBusy(false); return; }
    await logEvent(visit ? 'visit_rescheduled' : 'visit_added', {
      ...row, from: visit ? { tech_id: visit.tech_id, starts_at: visit.starts_at, ends_at: visit.ends_at } : undefined,
      override_double_booking: conflicts.length > 0,
    });
    setBusy(false);
    onDone();
  }

  return (
    <form onSubmit={save} style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div className="grid2">
        <div className="field"><label>Start</label><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></div>
        <div className="field"><label>End</label><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required /></div>
      </div>
      <div className="field"><label>Tech</label>
        <select value={techId} onChange={(e) => setTechId(e.target.value)}>
          <option value="">Unassigned</option>
          {staffList.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email} ({s.role})</option>)}
        </select>
      </div>
      {conflicts.length > 0 && (
        <div className="banner flag">
          This tech is already booked then:
          <ul style={{ margin: '6px 0' }}>
            {conflicts.map((c) => <li key={c.id}>#{c.job?.job_number} {c.job?.customer?.display_name} ({fmtDateTime(c.starts_at)})</li>)}
          </ul>
          <label className="row"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Book anyway. Both stay flagged until one is moved.</label>
        </div>
      )}
      {msg && <div className="msg err">{msg}</div>}
      <div className="row">
        <button className="primary" disabled={busy}>{busy ? 'Saving...' : visit ? 'Save changes' : 'Add visit'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
