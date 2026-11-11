'use client';

import { useEffect, useState } from 'react';
import PopupModal from '@/components/PopupModal';
import { getSupabase } from '@/lib/supabaseClient';
import { fmtDateTime, fmtDuration } from '@/lib/format';
import { staffName } from '@/lib/userDisplay';

// "Assign Job": pick the tech for a visit that has nobody on it yet. Warns if that tech is already
// booked at the time, and asks the office to confirm before double-booking.
export default function AssignJobModal({ open, visit, staffList, onClose, onDone, logEvent }) {
  const [techId, setTechId] = useState('');
  const [conflicts, setConflicts] = useState([]);
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { if (open) { setTechId(''); setConflicts([]); setOverride(false); setMsg(null); } }, [open]);

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

  return (
    <PopupModal open={open} onClose={() => { if (!busy) onClose(); }} title="Assign job">
      {visit && <p className="muted" style={{ marginTop: 0 }}>{fmtDateTime(visit.starts_at)} for {fmtDuration(visit.duration_minutes)}</p>}
      <div className="field">
        <label>Tech</label>
        <select value={techId} onChange={(e) => setTechId(e.target.value)} autoFocus>
          <option value="">Choose a tech...</option>
          {staffList.map((s) => <option key={s.id} value={s.id}>{staffName(s)} ({s.role})</option>)}
        </select>
      </div>
      {conflicts.length > 0 && (
        <div className="banner flag">
          Already booked then:
          <ul style={{ margin: '6px 0' }}>
            {conflicts.map((c) => <li key={c.id}>#{c.job?.job_number} {c.job?.customer?.display_name} ({fmtDateTime(c.starts_at)} for {fmtDuration(c.duration_minutes)})</li>)}
          </ul>
          <label className="row"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Assign anyway. Both jobs stay flagged until one is moved.</label>
        </div>
      )}
      {msg && <div className="msg err">{msg}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="primary" disabled={busy || !techId} onClick={save}>{busy ? 'Assigning...' : 'Assign'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </PopupModal>
  );
}
