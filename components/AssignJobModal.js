'use client';

import { useEffect, useState } from 'react';
import PopupModal from '@/components/PopupModal';
import WeekGrid from '@/components/WeekGrid';
import { weekStartMonday, techColor } from '@/lib/weekGrid';
import { getSupabase } from '@/lib/supabaseClient';
import { fmtDateTime, fmtDuration } from '@/lib/format';
import { staffName } from '@/lib/userDisplay';

// "Assign Job": pick the tech for a visit that has nobody on it yet. The popup shows the week's schedule
// with this visit drawn in, so you can see who is free. Warns if the chosen tech is already booked at the
// time, and asks the office to confirm before double-booking.
export default function AssignJobModal({ open, visit, staffList, onClose, onDone, logEvent }) {
  const [techId, setTechId] = useState('');
  const [conflicts, setConflicts] = useState([]);
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [weekStart, setWeekStart] = useState(() => weekStartMonday(new Date()));

  useEffect(() => {
    if (open) { setTechId(''); setConflicts([]); setOverride(false); setMsg(null); if (visit) setWeekStart(weekStartMonday(new Date(visit.starts_at))); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !visit || !techId) { setConflicts([]); return undefined; }
    let live = true;
    const start = new Date(visit.starts_at).toISOString();
    const end = new Date(new Date(visit.starts_at).getTime() + visit.duration_minutes * 60000).toISOString();
    getSupabase().from('job_visits')
      .select('id,starts_at,duration_minutes,job:jobs(job_number,customer:customers(display_name))')
      .eq('tech_id', techId).in('status', ['scheduled', 'on_the_way', 'started'])
      .neq('id', visit.id).lt('starts_at', end).gt('ends_at', start)
      .then(({ data }) => { if (live) { setConflicts(data || []); setOverride(false); } });
    return () => { live = false; };
  }, [open, visit, techId]);

  async function save() {
    if (!techId) { setMsg('Pick a tech.'); return; }
    if (conflicts.length && !override) { setMsg('Tick the box to double-book, or pick another tech.'); return; }
    setBusy(true);
    setMsg(null);
    const { error } = await getSupabase().from('job_visits').update({ tech_id: techId }).eq('id', visit.id);
    if (error) { setMsg(error.message); setBusy(false); return; }
    await logEvent?.('visit_assigned', { visit_id: visit.id, tech_id: techId, override_double_booking: conflicts.length > 0 });
    setBusy(false);
    onClose();
    onDone();
  }

  const techIds = staffList.map((s) => s.id);

  return (
    <PopupModal open={open} onClose={() => { if (!busy) onClose(); }} title="Assign job" wide>
      <div className="assign-modal">
        {visit && <p className="muted" style={{ marginTop: 0 }}>{fmtDateTime(visit.starts_at)} for {fmtDuration(visit.duration_minutes)}. The dashed box is this job; tap a tech to see only their schedule.</p>}
        <div className="assign-techs" role="radiogroup" aria-label="Tech">
          {staffList.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={techId === s.id} className={`assign-tech${techId === s.id ? ' on' : ''}`}
              onClick={() => setTechId(techId === s.id ? '' : s.id)}>
              <i style={{ background: techColor(techIds, s.id) }} />{staffName(s)} <small>{s.role}</small>
            </button>
          ))}
        </div>
        {visit && (
          <WeekGrid
            weekStart={weekStart}
            onWeekChange={setWeekStart}
            techs={staffList}
            focusTechId={techId}
            proposed={{ start: visit.starts_at, duration: visit.duration_minutes }}
            proposedLabel="This job"
            excludeVisitId={visit.id}
          />
        )}
        {conflicts.length > 0 && (
          <div className="banner flag" style={{ marginTop: 10 }}>
            Already booked then:
            <ul style={{ margin: '6px 0' }}>
              {conflicts.map((c) => <li key={c.id}>#{c.job?.job_number} {c.job?.customer?.display_name} ({fmtDateTime(c.starts_at)} for {fmtDuration(c.duration_minutes)})</li>)}
            </ul>
            <label className="row"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Assign anyway. Both jobs stay flagged until one is moved.</label>
          </div>
        )}
        {msg && <div className="msg err">{msg}</div>}
        <div className="row assign-actions">
          <button type="button" className="primary" disabled={busy || !techId} onClick={save}>{busy ? 'Assigning...' : techId ? `Assign to ${staffName(staffList.find((s) => s.id === techId))}` : 'Choose a tech'}</button>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </PopupModal>
  );
}
