'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { fmtTime, toLocalInput, fromLocalInput } from '@/lib/format';
import { dayRows, dayKey, hmWords, hmText, addDaysKey } from '@/lib/shiftClock';
import { ClockInIcon, ClockOutIcon, BreakIcon } from '@/components/job/QuickIcons';
import ReasonField from '@/components/ReasonField';
import './shiftclock.css';
import '@/components/dashboard/dashboardmobile.css';

const when = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const STATUS = { pending: 'Waiting for the owner', approved: 'Approved', rejected: 'Not approved' };

// The shift clock on a person's own dashboard: clock in, start/end a break, clock out, see this week's shifts, and ask for a change
// the owner has to approve. Separate from the job clock, which times work on one job.
export default function ShiftClock({ staff, hideWeek = false, onChanged }) {
  const sb = getSupabase();
  const [shifts, setShifts] = useState([]); const [breaks, setBreaks] = useState([]); const [sessions, setSessions] = useState([]); const [requests, setRequests] = useState([]);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [setup, setSetup] = useState(false);
  const [showWeek, setShowWeek] = useState(false); // phones: the week's shifts stay folded away until asked for
  const [form, setForm] = useState(null); // { target, shift_id?, break_id?, started, ended, reason, label }

  const token = async () => (await sb.auth.getSession()).data?.session?.access_token;
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const [s, b, j, r] = await Promise.all([
      sb.from('shifts').select('*').eq('staff_id', staff.id).gte('started_at', since).is('voided_at', null).order('started_at'),
      sb.from('shift_breaks').select('*').eq('staff_id', staff.id).gte('started_at', since).is('voided_at', null).order('started_at'),
      sb.from('job_clock_sessions').select('id,started_at,ended_at,voided_at').eq('staff_id', staff.id).gte('started_at', since).is('voided_at', null),
      sb.from('shift_edit_requests').select('*').eq('requested_by', staff.id).order('created_at', { ascending: false }).limit(20),
    ]);
    if (s.error && /does not exist|schema cache/i.test(s.error.message)) { setSetup(true); return; }
    setShifts(s.data || []); setBreaks(b.data || []); setSessions(j.data || []); setRequests(r.data || []);
  }, [sb, staff.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  const open = shifts.find((s) => !s.ended_at) || null;
  const onBreak = open ? breaks.find((b) => b.shift_id === open.id && !b.ended_at) || null : null;
  const days = useMemo(() => dayRows({ shifts, breaks, sessions, role: staff.role, now }), [shifts, breaks, sessions, staff.role, now]);
  const pendingFor = (kind, id) => requests.some((r) => r.status === 'pending' && (kind === 'break' ? r.break_id === id : r.shift_id === id));
  const today = days.find((d) => d.date === dayKey(now));

  async function act(action) {
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch('/api/shifts', await token(), { method: 'POST', body: JSON.stringify({ action }) });
      if (r?.discarded) setMsg({ text: `That shift was under ${r.minutes || 5} minutes, so it was not recorded.` });
      await load();
      onChanged?.();
    }
    catch (e) { setMsg({ err: true, text: e.message }); await load(); onChanged?.(); }
    setBusy(false);
  }
  function ask(target, row, label) {
    const base = row || {};
    const d = dayKey(now);
    setForm({
      target, label, shift_id: target === 'shift' ? row.id : undefined, break_id: target === 'break' ? row.id : undefined,
      started: toLocalInput(base.started_at || `${addDaysKey(d, -1)}T14:00:00Z`), ended: toLocalInput(base.ended_at || `${addDaysKey(d, -1)}T23:00:00Z`), reason: '', reasonChoice: '',
    });
    setMsg(null);
  }
  async function send(e) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await apiFetch('/api/shifts/requests', await token(), { method: 'POST', body: JSON.stringify({ target: form.target, shift_id: form.shift_id, break_id: form.break_id, started_at: fromLocalInput(form.started), ended_at: fromLocalInput(form.ended), reason: form.reason }) });
      setForm(null); setMsg({ text: 'Submitted for review. Your times stay as they are until it is approved.' }); await load();
    } catch (err) { setMsg({ err: true, text: err.message }); }
    setBusy(false);
  }

  if (setup) return null; // the shift clock is not set up yet (migration 025); say nothing rather than show a broken card
  const running = open ? Math.max(0, Math.round((now - new Date(open.started_at)) / 60000)) : 0;
  return (
    <section className={`card shiftclock${open ? ' running' : ''}${onBreak ? ' on-break' : ''}${showWeek ? ' week-open' : ''}`} aria-label="Shift clock">
      <div className="sc-head">
        <div>
          <h2 style={{ margin: 0 }}>Shift clock</h2>
          <div className="muted sc-status">
            {!open && 'Not clocked in.'}
            {open && !onBreak && `Clocked in at ${fmtTime(open.started_at)} (${hmWords(running)} so far).`}
            {open && onBreak && `On a break since ${fmtTime(onBreak.started_at)}.`}
            {today && today.netMinutes > 0 && ` Today so far: ${hmText(today.netMinutes)} worked.`}
          </div>
        </div>
        <div className="sc-buttons">
          {!open && <button type="button" className="primary sc-big" disabled={busy} onClick={() => act('in')}>{<ClockInIcon width={28} height={28} />}Clock in</button>}
          {open && !onBreak && <button type="button" className="secondary sc-big" disabled={busy} onClick={() => act('break_start')}><BreakIcon width={28} height={28} />Start break</button>}
          {open && onBreak && <button type="button" className="primary sc-big" disabled={busy} onClick={() => act('break_end')}><BreakIcon width={28} height={28} />End break</button>}
          {open && <button type="button" className="danger sc-big" disabled={busy} onClick={() => { if (window.confirm('Clock out for the day?')) act('out'); }}>{<ClockOutIcon width={28} height={28} />}Clock out</button>}
        </div>
      </div>
      {msg && <div className={`msg${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'}>{msg.text}</div>}

      {form && (
        <form className="sc-form" onSubmit={send}>
          <strong>{form.label}</strong>
          <label>Start<input type="datetime-local" value={form.started} onChange={(e) => setForm({ ...form, started: e.target.value })} required /></label>
          <label>End<input type="datetime-local" value={form.ended} onChange={(e) => setForm({ ...form, ended: e.target.value })} required /></label>
          <ReasonField form={form} setForm={setForm} />
          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className="primary" disabled={busy}>Submit for Review</button>
            <button type="button" className="secondary" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      {!hideWeek && <button type="button" className="secondary sc-week-toggle" aria-expanded={showWeek} onClick={() => setShowWeek(!showWeek)}>{showWeek ? 'Hide this week' : 'This week'}</button>}
      {!hideWeek && <div className="sc-days">
        {days.slice(0, 7).map((d) => (
          <div key={d.date} className="sc-day">
            <div className="sc-dayhead"><strong>{when(d.date)}</strong><span className="muted">{hmText(d.netMinutes)} worked{d.breakMinutes ? `, ${d.breakMinutes} min break` : ''}</span></div>
            {d.shifts.map(({ shift, breaks: bs }) => (
              <div key={shift.id} className="sc-shift">
                <span>{fmtTime(shift.started_at)} &ndash; {shift.ended_at ? fmtTime(shift.ended_at) : 'now'}{shift.edited_at ? ' (changed)' : ''}</span>
                {shift.ended_at && (pendingFor('shift', shift.id) ? <span className="muted">Change waiting</span> : <button type="button" className="link" onClick={() => ask('shift', shift, 'Ask to change this shift')}>Edit Shift</button>)}
                {bs.map((b) => (
                  <div key={b.id} className="sc-break muted">
                    Break {fmtTime(b.started_at)} &ndash; {b.ended_at ? fmtTime(b.ended_at) : 'now'}
                    {b.ended_at && (pendingFor('break', b.id) ? ' (change waiting)' : <> <button type="button" className="link" onClick={() => ask('break', b, 'Ask to change this break')}>Edit Break</button></>)}
                  </div>
                ))}
              </div>
            ))}
            {d.flags.filter((f) => f.level === 'warn').map((f, i) => <div key={i} className="sc-flag">{f.text}</div>)}
          </div>
        ))}
        {days.length === 0 && <p className="muted">No shifts in the last two weeks.</p>}
      </div>}
      {!hideWeek && <button type="button" className="link sc-forgot" onClick={() => ask('add', null, 'Ask to add a shift you did not clock')}>Add Shift</button>}

      {!hideWeek && requests.slice(0, 5).some((r) => r.status !== 'pending') && (
        <div className="sc-reqs">
          {requests.filter((r) => r.status !== 'pending').slice(0, 3).map((r) => (
            <div key={r.id} className="muted">{STATUS[r.status]}: {r.target === 'add' ? 'added shift' : r.target === 'break' ? 'break change' : 'shift change'} on {when(dayKey(r.new_started_at))}{r.decision_note ? `. ${r.decision_note}` : ''}</div>
          ))}
        </div>
      )}
    </section>
  );
}
