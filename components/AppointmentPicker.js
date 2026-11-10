'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import WeekGrid from '@/components/WeekGrid';
import { DURATION_CHOICES, fmtDuration, fmtDateTime, fromLocalInput, toLocalInput } from '@/lib/format';
import { weekStartMonday } from '@/lib/weekGrid';

export function defaultAppointment() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return { start: toLocalInput(d), duration: 120, techId: '', override: false };
}

// Start time + length + tech, with the week's schedule beside it so the best slot can be seen and
// clicked. There is no end time: an appointment is a start and a duration.
// value: { start: 'YYYY-MM-DDTHH:mm' (local), duration: minutes, techId, override }
export default function AppointmentPicker({ value, onChange, staffList, excludeVisitId = null, onConflicts, split = false }) {
  const [weekStart, setWeekStart] = useState(() => weekStartMonday(value.start ? new Date(value.start) : new Date()));
  const [conflicts, setConflicts] = useState([]);

  const startDate = value.start ? new Date(value.start) : null;
  const validStart = startDate && !Number.isNaN(startDate.getTime());
  const set = (patch) => onChange({ ...value, override: false, ...patch });

  // when the start moves to another week (typed in, or picked), show that week
  useEffect(() => {
    if (!validStart) return;
    const ws = weekStartMonday(startDate);
    setWeekStart((cur) => (cur.getTime() === ws.getTime() ? cur : ws));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.start]);

  // double-booking check for the chosen tech and time
  useEffect(() => {
    let cancelled = false;
    if (!value.techId || !validStart || !(value.duration > 0)) { setConflicts([]); onConflicts?.([]); return undefined; }
    const startIso = fromLocalInput(value.start);
    const endIso = new Date(new Date(startIso).getTime() + value.duration * 60000).toISOString();
    let q = getSupabase().from('job_visits')
      .select('id,starts_at,duration_minutes,job:jobs(job_number,customer:customers(display_name))')
      .eq('tech_id', value.techId).in('status', ['scheduled', 'on_the_way', 'started'])
      .lt('starts_at', endIso).gt('ends_at', startIso);
    if (excludeVisitId) q = q.neq('id', excludeVisitId);
    q.then(({ data }) => {
      if (cancelled) return;
      setConflicts(data || []);
      onConflicts?.(data || []);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.techId, value.start, value.duration, excludeVisitId]);

  const durations = useMemo(
    () => (DURATION_CHOICES.includes(Number(value.duration)) ? DURATION_CHOICES : [...DURATION_CHOICES, Number(value.duration)].sort((a, b) => a - b)),
    [value.duration],
  );

  return (
    <div className={split ? 'appt-split' : undefined}>
      <div className="appt-controls">
      <div className="grid2">
        <div className="field">
          <label>Start</label>
          <input type="datetime-local" step="900" value={value.start} onChange={(e) => set({ start: e.target.value })} required />
        </div>
        <div className="field">
          <label>Length</label>
          <select value={value.duration} onChange={(e) => set({ duration: Number(e.target.value) })}>
            {durations.map((m) => <option key={m} value={m}>{fmtDuration(m)}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Tech</label>
        <select value={value.techId} onChange={(e) => set({ techId: e.target.value })}>
          <option value="">Unassigned</option>
          {staffList.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email} ({s.role})</option>)}
        </select>
      </div>
      {validStart && <p className="hint" style={{ marginTop: -6 }}>Appointment: <strong>{fmtDateTime(startDate)} for {fmtDuration(value.duration)}</strong></p>}

      {conflicts.length > 0 && (
        <div className="banner flag">
          This tech is already booked then:
          <ul style={{ margin: '6px 0' }}>
            {conflicts.map((c) => <li key={c.id}>#{c.job?.job_number} {c.job?.customer?.display_name} ({fmtDateTime(c.starts_at)} for {fmtDuration(c.duration_minutes)})</li>)}
          </ul>
          <label className="row"><input type="checkbox" checked={!!value.override} onChange={(e) => onChange({ ...value, override: e.target.checked })} /> Book anyway. Both jobs stay flagged until one is moved.</label>
        </div>
      )}

      </div>
      <div className="appt-grid">
      <WeekGrid
        weekStart={weekStart}
        onWeekChange={setWeekStart}
        techs={staffList}
        focusTechId={value.techId}
        proposed={validStart ? { start: startDate, duration: value.duration } : null}
        excludeVisitId={excludeVisitId}
        onPick={(date) => set({ start: toLocalInput(date) })}
        hint="Click an open spot in the week to set the start time, or drag the dashed box (the appointment you are setting) to a new time or day."
      />
      </div>
    </div>
  );
}
