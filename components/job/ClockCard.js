'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { fmtDateTime, fmtTime, toLocalInput, fromLocalInput } from '@/lib/format';
import { staffName } from '@/lib/userDisplay';
import { colorHex } from '@/lib/userColors';
import { allottedMinutes, clockText, durationText, sessionMinutes, totalMinutes, EDIT_STATUS } from '@/lib/jobClock';
import './clock.css';

// Job > Overview: the job clock. A tech sees their own entries; office and owner see everyone's.
// The clock itself runs from the visit buttons (On the way / Start job / Finish job); this card shows it, lets the person clock
// out and back in for a break, and lets a tech ask for a time change (the owner approves it).
// No money here. Office and owner also see allotted time against clocked time on carpet jobs.
export default function ClockCard({ jobId, staff, staffList, token, service, jobStatus, refreshKey = '', onChanged }) {
  const sb = getSupabase();
  const [sessions, setSessions] = useState([]);
  const [requests, setRequests] = useState([]);
  const [visitStarted, setVisitStarted] = useState(false);
  const [allot, setAllot] = useState(null);
  const [colors, setColors] = useState({}); // staff id -> { color, created_at }
  const [state, setState] = useState({ loading: true, error: '' });
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [edit, setEdit] = useState(null); // { id, start, end, reason, direct }
  const office = staff.role !== 'tech';
  const isOwner = staff.role === 'owner';
  const closedJob = ['closed', 'cancelled'].includes(jobStatus);

  const load = useCallback(async () => {
    const [s, r, v, c] = await Promise.all([
      sb.from('job_clock_sessions').select('*').eq('job_id', jobId).order('started_at', { ascending: true }),
      sb.from('job_time_edit_requests').select('*').eq('job_id', jobId).order('created_at', { ascending: false }),
      sb.from('job_visits').select('id').eq('job_id', jobId).eq('tech_id', staff.id).eq('status', 'started').limit(1),
      sb.from('staff_users').select('id,color,created_at'),
    ]);
    if (!c.error) setColors(Object.fromEntries((c.data || []).map((p) => [p.id, p])));
    const failed = [s, r].find((x) => x.error);
    if (failed) { setState({ loading: false, error: /does not exist|schema cache/i.test(failed.error.message) ? 'The job clock is not set up yet. Run migration 024, then reload.' : failed.error.message }); return; }
    setSessions(s.data || []); setRequests(r.data || []); setVisitStarted((v.data || []).length > 0);
    if (office && service === 'carpet') {
      const [e, p] = await Promise.all([
        sb.from('estimates').select('status,chosen_tier,lines:estimate_lines(id,price_item_id,unit,quantity,unit_price,tier,optional,accepted)').eq('job_id', jobId).maybeSingle(),
        sb.from('price_items').select('id,minutes_per_unit'),
      ]);
      const rates = Object.fromEntries((p.data || []).map((i) => [i.id, i.minutes_per_unit]));
      setAllot(e.data ? allottedMinutes(e.data, rates) : null);
    }
    setState({ loading: false, error: '' });
  }, [sb, jobId, staff.id, office, service]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const mine = sessions.find((s) => s.staff_id === staff.id && !s.ended_at && !s.voided_at) || null;
  useEffect(() => {
    if (!sessions.some((s) => !s.ended_at && !s.voided_at)) return undefined;
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, [sessions]);

  const pendingBySession = useMemo(() => new Map(requests.filter((r) => r.status === 'pending').map((r) => [r.session_id, r])), [requests]);
  const people = useMemo(() => staffList.map((p) => ({ ...p, ...(colors[p.id] || {}) })), [staffList, colors]);
  const person = (id) => people.find((p) => p.id === id);
  const shown = (office ? sessions : sessions.filter((s) => s.staff_id === staff.id)).filter((s) => !s.voided_at);
  const clocked = totalMinutes(shown, now);

  async function call(key, path, options, ok) {
    setBusy(key); setMsg(null);
    try { await apiFetch(path, token, options); await load(); onChanged?.(); if (ok) setMsg({ text: ok }); return true; }
    catch (e) { setMsg({ err: true, text: e.message || 'Something went wrong.' }); return false; }
    finally { setBusy(''); }
  }
  const clockOut = (staffId) => call('out', `/api/jobs/${jobId}/clock`, { method: 'POST', body: JSON.stringify({ action: 'out', staff_id: staffId }) }, 'Clocked out.');
  const clockIn = () => call('in', `/api/jobs/${jobId}/clock`, { method: 'POST', body: JSON.stringify({ action: 'in' }) }, 'Clocked in.');

  function openEdit(s, direct) { setMsg(null); setEdit({ id: s.id, start: toLocalInput(s.started_at), end: toLocalInput(s.ended_at), reason: '', direct }); }
  async function submitEdit(e) {
    e.preventDefault();
    let started; let ended;
    try { started = fromLocalInput(edit.start); ended = fromLocalInput(edit.end); } catch { setMsg({ err: true, text: 'Enter both a start and an end time.' }); return; }
    const ok = edit.direct
      ? await call('edit', `/api/clock/sessions/${edit.id}`, { method: 'PATCH', body: JSON.stringify({ started_at: started, ended_at: ended }) }, 'Time entry changed.')
      : await call('edit', '/api/clock/edit-requests', { method: 'POST', body: JSON.stringify({ session_id: edit.id, started_at: started, ended_at: ended, reason: edit.reason }) }, 'Sent to the owner for approval. The old times stay until it is approved.');
    if (ok) setEdit(null);
  }
  async function removeEntry(s) {
    const reason = window.prompt('Remove this time entry? It stays on the list as removed and stops counting. Why? (optional)', '');
    if (reason === null) return;
    await call(`rm-${s.id}`, `/api/clock/sessions/${s.id}`, { method: 'PATCH', body: JSON.stringify({ void: true, reason }) }, 'Entry removed.');
  }
  const decide = (r, decision) => {
    const note = decision === 'reject' ? window.prompt('Why is it not approved? (optional, the tech sees this)', '') : '';
    if (note === null) return null;
    return call(`dec-${r.id}`, `/api/clock/edit-requests/${r.id}`, { method: 'POST', body: JSON.stringify({ decision, note }) }, decision === 'approve' ? 'Change approved.' : 'Change turned down.');
  };

  if (state.loading) return null;
  if (state.error) return isOwner ? <div className="card wide"><h2>Job clock</h2><div className="msg err">{state.error}</div></div> : null;
  if (!shown.length && !mine && !visitStarted && !office) return null; // nothing to show a tech yet
  const usedPct = allot?.any && clocked > 0 ? Math.round((clocked / allot.minutes) * 100) : null;

  return (
    <div className="card wide clock-card">
      <div className="clock-head">
        <h2 style={{ margin: 0 }}>Job clock</h2>
        {mine && <span className="clock-chip run" role="status">Running {clockText(sessionMinutes(mine, now))}</span>}
        <span className="clock-total">{shown.length ? `Total ${durationText(clocked)}` : 'No time yet'}</span>
      </div>
      {office && service === 'carpet' && allot?.any && (
        <div className={`clock-allot${usedPct != null && usedPct > 100 ? ' over' : ''}`}>
          Allotted {durationText(allot.minutes)}{clocked > 0 ? ` · clocked ${durationText(clocked)} (${usedPct}% of allotted)` : ''}
          {allot.unrated > 0 && <span className="muted"> · {allot.unrated} line{allot.unrated === 1 ? ' has' : 's have'} no time rate in the price list</span>}
        </div>
      )}
      {msg && <div className={`msg${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'}>{msg.text}</div>}

      {!closedJob && (mine || visitStarted) && (
        <div className="clock-actions">
          {mine
            ? <button type="button" className="secondary big" disabled={busy === 'out'} onClick={() => clockOut(staff.id)}>Clock out (break)</button>
            : <button type="button" className="primary big" disabled={busy === 'in'} onClick={clockIn}>Clock back in</button>}
          <span className="muted">Starting and finishing the job runs the clock for you. Use this for lunch or a break.</span>
        </div>
      )}

      {shown.length > 0 && (
        <div className="clock-list">
          {[...shown].reverse().map((s) => {
            const p = person(s.staff_id);
            const pend = pendingBySession.get(s.id);
            const open = !s.ended_at;
            const travel = s.arrived_at ? Math.round((new Date(s.arrived_at) - new Date(s.started_at)) / 60000) : 0;
            return (
              <div key={s.id} className="clock-row">
                <div className="clock-main">
                  <div className="title">
                    {office && <span className="clock-dot" style={{ background: colorHex(p || { id: s.staff_id }, people) }} aria-hidden="true" />}
                    {office && <>{p ? staffName(p) : 'Someone'}{' · '}</>}
                    {fmtDateTime(s.started_at)} to {open ? 'now' : fmtTime(s.ended_at)}
                  </div>
                  <div className="meta">
                    {durationText(sessionMinutes(s, now))}
                    {travel > 0 && ` · includes ${durationText(travel)} travel`}
                    {s.edited_at && ' · changed'}
                    {pend && <> · <span className="badge warn">Change waiting for the owner</span></>}
                  </div>
                </div>
                <div className="clock-buttons">
                  {open && office && s.staff_id !== staff.id && <button type="button" className="secondary small" disabled={busy === 'out'} onClick={() => clockOut(s.staff_id)}>Stop clock</button>}
                  {!open && !pend && (isOwner
                    ? <><button type="button" className="secondary small" onClick={() => openEdit(s, true)}>Edit</button><button type="button" className="linklike danger-link" onClick={() => removeEntry(s)}>Remove</button></>
                    : s.staff_id === staff.id && <button type="button" className="secondary small" onClick={() => openEdit(s, false)}>Request change</button>)}
                  {pend && isOwner && (
                    <>
                      <button type="button" className="primary small" disabled={busy === `dec-${pend.id}`} onClick={() => decide(pend, 'approve')}>Approve</button>
                      <button type="button" className="secondary small" disabled={busy === `dec-${pend.id}`} onClick={() => decide(pend, 'reject')}>Not approved</button>
                    </>
                  )}
                </div>
                {pend && (
                  <div className="clock-request">
                    Asks for {fmtDateTime(pend.new_started_at)} to {fmtTime(pend.new_ended_at)}: {pend.reason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {edit && (
        <form className="clock-edit" onSubmit={submitEdit}>
          <h3 style={{ marginTop: 0 }}>{edit.direct ? 'Change this time entry' : 'Ask for a time change'}</h3>
          <div className="field"><label htmlFor="ck-start">Start</label><input id="ck-start" type="datetime-local" value={edit.start} onChange={(e) => setEdit({ ...edit, start: e.target.value })} required /></div>
          <div className="field"><label htmlFor="ck-end">End</label><input id="ck-end" type="datetime-local" value={edit.end} onChange={(e) => setEdit({ ...edit, end: e.target.value })} required /></div>
          {!edit.direct && <div className="field"><label htmlFor="ck-why">Why does it need to change?</label><input id="ck-why" type="text" maxLength={300} value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} required /></div>}
          {!edit.direct && <p className="hint">The owner gets this to approve. Your old times stay until then.</p>}
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" type="submit" disabled={busy === 'edit'}>{edit.direct ? 'Save' : 'Send for approval'}</button>
            <button className="secondary" type="button" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </form>
      )}

      {requests.some((r) => r.status !== 'pending') && (
        <details className="clock-history">
          <summary>Past change requests</summary>
          {requests.filter((r) => r.status !== 'pending').map((r) => (
            <div key={r.id} className="meta">{EDIT_STATUS[r.status]}: {fmtDateTime(r.new_started_at)} to {fmtTime(r.new_ended_at)} · {r.reason}{r.decision_note ? ` · ${r.decision_note}` : ''}</div>
          ))}
        </details>
      )}
    </div>
  );
}
