'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { fmtTime, fromLocalInput, toLocalInput } from '@/lib/format';
import { dayRows, dayKey, dayStartInstant, addDaysKey, weekStartKey, weekKeys, hmText, hmWords } from '@/lib/shiftClock';
import ReasonField from '@/components/ReasonField';
import './weektimeclock.css';

const STATUS = { pending: 'Waiting for the owner', approved: 'Approved', rejected: 'Not approved' };
const dayName = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
const dayShort = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// A person's own time clock for a whole week (Monday to Sunday): every shift and break, the time on jobs, the day's total, and a way to
// ask for a change. Nothing changes until the owner approves. `refreshKey` reloads it (the clock buttons on the page bump it).
export default function WeekTimeClock({ staff, refreshKey = 0 }) {
  const sb = getSupabase();
  const [start, setStart] = useState(() => weekStartKey(dayKey(new Date())));
  const [shifts, setShifts] = useState([]); const [breaks, setBreaks] = useState([]); const [sessions, setSessions] = useState([]); const [requests, setRequests] = useState([]);
  const [now, setNow] = useState(() => new Date());
  const [state, setState] = useState({ loading: true, setup: false, error: '' });
  const [form, setForm] = useState(null); // { target, shift_id?, break_id?, started, ended, reason, label }
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);

  const from = useMemo(() => dayStartInstant(start).toISOString(), [start]);
  const to = useMemo(() => dayStartInstant(addDaysKey(start, 7)).toISOString(), [start]);
  const thisWeek = weekStartKey(dayKey(now));

  const load = useCallback(async () => {
    const [s, b, j, r] = await Promise.all([
      sb.from('shifts').select('*').eq('staff_id', staff.id).gte('started_at', from).lt('started_at', to).is('voided_at', null).order('started_at'),
      sb.from('shift_breaks').select('*').eq('staff_id', staff.id).gte('started_at', from).lt('started_at', to).is('voided_at', null).order('started_at'),
      sb.from('job_clock_sessions').select('id,started_at,ended_at,voided_at').eq('staff_id', staff.id).gte('started_at', from).lt('started_at', to).is('voided_at', null),
      sb.from('shift_edit_requests').select('*').eq('requested_by', staff.id).order('created_at', { ascending: false }).limit(60),
    ]);
    if (s.error && /does not exist|schema cache/i.test(s.error.message)) { setState({ loading: false, setup: true, error: '' }); return; }
    if (s.error) { setState({ loading: false, setup: false, error: s.error.message }); return; }
    setShifts(s.data || []); setBreaks(b.data || []); setSessions(j.data || []); setRequests(r.data || []);
    setState({ loading: false, setup: false, error: '' });
  }, [sb, staff.id, from, to]);
  useEffect(() => { setState((x) => ({ ...x, loading: true })); load(); }, [load, refreshKey]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  const byDate = useMemo(() => new Map(dayRows({ shifts, breaks, sessions, role: staff.role, now }).map((d) => [d.date, d])), [shifts, breaks, sessions, staff.role, now]);
  const keys = weekKeys(start);
  const weekNet = keys.reduce((n, k) => n + (byDate.get(k)?.netMinutes || 0), 0);
  const weekJobs = keys.reduce((n, k) => n + (byDate.get(k)?.jobMinutes || 0), 0);
  const pendingFor = (kind, id) => requests.some((r) => r.status === 'pending' && (kind === 'break' ? r.break_id === id : r.shift_id === id));
  const weekRequests = requests.filter((r) => { const k = dayKey(r.new_started_at); return k >= start && k <= addDaysKey(start, 6); });

  function ask(target, row, label, key) {
    const base = row || {};
    setForm({
      target, label, shift_id: target === 'shift' ? row.id : undefined, break_id: target === 'break' ? row.id : undefined,
      started: base.started_at ? toLocalInput(base.started_at) : `${key}T07:00`,
      ended: base.ended_at ? toLocalInput(base.ended_at) : `${key}T16:00`,
      reason: '', reasonChoice: '', day: key,
    });
    setMsg(null);
  }
  async function send(e) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const token = (await sb.auth.getSession()).data?.session?.access_token;
      await apiFetch('/api/shifts/requests', token, { method: 'POST', body: JSON.stringify({ target: form.target, shift_id: form.shift_id, break_id: form.break_id, started_at: fromLocalInput(form.started), ended_at: fromLocalInput(form.ended), reason: form.reason }) });
      setForm(null); setMsg({ text: 'Submitted for review. Your times stay as they are until it is approved.' }); await load();
    } catch (err) { setMsg({ err: true, text: err.message }); }
    setBusy(false);
  }

  if (state.setup) return null; // the day clock is not set up yet (migration 025)
  const editForm = (key) => form && form.day === key && (
    <form className="wtc-form" onSubmit={send}>
      <strong>{form.label}</strong>
      <label>Start<input type="datetime-local" value={form.started} onChange={(e) => setForm({ ...form, started: e.target.value })} required /></label>
      <label>End<input type="datetime-local" value={form.ended} onChange={(e) => setForm({ ...form, ended: e.target.value })} required /></label>
      <ReasonField form={form} setForm={setForm} />
      <div className="wtc-form-buttons">
        <button type="submit" className="primary" disabled={busy}>Submit for Review</button>
        <button type="button" className="secondary" onClick={() => setForm(null)}>Cancel</button>
      </div>
    </form>
  );

  return (
    <section className="wtc" aria-label="Week of time clock">
      <div className="wtc-nav">
        <button type="button" className="secondary" aria-label="Previous week" onClick={() => setStart(addDaysKey(start, -7))}>&lsaquo;</button>
        <div className="wtc-range">
          <strong>{dayShort(start)} &ndash; {dayShort(addDaysKey(start, 6))}</strong>
          {start === thisWeek ? <span className="muted">This week</span> : <button type="button" className="link" onClick={() => setStart(thisWeek)}>Back to this week</button>}
        </div>
        <button type="button" className="secondary" aria-label="Next week" disabled={start >= thisWeek} onClick={() => setStart(addDaysKey(start, 7))}>&rsaquo;</button>
      </div>

      <div className="wtc-total card">
        <div><div className="wtc-big">{hmText(weekNet)}</div><div className="muted">worked</div></div>
        <div><div className="wtc-big">{hmText(weekJobs)}</div><div className="muted">on jobs</div></div>
      </div>

      {state.error && <div className="msg err" role="alert">{state.error}</div>}
      {msg && <div className={`msg${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'}>{msg.text}</div>}

      {keys.map((key) => {
        const d = byDate.get(key);
        const future = key > dayKey(now);
        return (
          <div key={key} className={`wtc-day card${key === dayKey(now) ? ' today' : ''}${future ? ' future' : ''}`}>
            <div className="wtc-dayhead">
              <div><strong>{dayName(key)}</strong> <span className="muted">{dayShort(key)}</span></div>
              <div className="wtc-daytotal">{d ? hmText(d.netMinutes) : '0:00'}</div>
            </div>
            {d && d.jobMinutes > 0 && <div className="muted wtc-sub">{hmWords(d.jobMinutes)} on jobs{d.breakMinutes ? ` · ${d.breakMinutes} min break` : ''}</div>}
            {!d && !future && <div className="muted wtc-sub">No time clocked.</div>}
            {d && d.shifts.map(({ shift, breaks: bs }) => (
              <div key={shift.id} className="wtc-shift">
                <div className="wtc-line">
                  <span>{fmtTime(shift.started_at)} &ndash; {shift.ended_at ? fmtTime(shift.ended_at) : 'now'}{shift.edited_at ? ' (changed)' : ''}</span>
                  {shift.ended_at && (pendingFor('shift', shift.id) ? <span className="muted">Change waiting</span> : <button type="button" className="secondary small" onClick={() => ask('shift', shift, 'Ask to change this shift', key)}>Edit Shift</button>)}
                </div>
                {bs.map((b) => (
                  <div key={b.id} className="wtc-line wtc-break muted">
                    <span>Break {fmtTime(b.started_at)} &ndash; {b.ended_at ? fmtTime(b.ended_at) : 'now'}</span>
                    {b.ended_at && (pendingFor('break', b.id) ? <span>Change waiting</span> : <button type="button" className="secondary small" onClick={() => ask('break', b, 'Ask to change this break', key)}>Edit Break</button>)}
                  </div>
                ))}
              </div>
            ))}
            {d && d.flags.filter((f) => f.level === 'warn').map((f, i) => <div key={i} className="wtc-flag">{f.text}</div>)}
            {!future && <button type="button" className="secondary wtc-add" onClick={() => ask('add', null, `Ask to add a shift on ${dayName(key)}`, key)}>Add Shift</button>}
            {editForm(key)}
          </div>
        );
      })}

      {weekRequests.length > 0 && (
        <div className="wtc-reqs card">
          <strong>Requests this week</strong>
          {weekRequests.map((r) => (
            <div key={r.id} className="wtc-req"><span>{dayShort(dayKey(r.new_started_at))}: {r.target === 'add' ? 'added shift' : r.target === 'break' ? 'break change' : 'shift change'}</span><span className={`wtc-status ${r.status}`}>{STATUS[r.status]}</span>{r.decision_note && <div className="muted">{r.decision_note}</div>}</div>
          ))}
        </div>
      )}
    </section>
  );
}
