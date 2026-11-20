'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { fmtTime, toLocalInput, fromLocalInput } from '@/lib/format';
import { staffName } from '@/lib/userDisplay';
import { colorFor } from '@/lib/userColors';
import { dayRows, dayKey, weekStartKey, weekKeys, addDaysKey, dayStartInstant, hmText, hmWords, shiftsCsv, REQUEST_WHAT } from '@/lib/shiftClock';
import '@/components/shiftclock.css';

const when = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// Owner only. Every employee's shifts for a week (start to stop, with breaks), what does not add up, and the change requests
// waiting for approval. Flags are worked out on screen from the shifts, breaks and job clock, never stored.
export default function TimeClockTab() {
  const sb = getSupabase();
  const [week, setWeek] = useState(() => weekStartKey(dayKey(new Date())));
  const [data, setData] = useState({ loading: true });
  const [requests, setRequests] = useState([]);
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState(null); // { shiftId?, breakId?, staffId?, started, ended }
  const [notes, setNotes] = useState({});
  const [now] = useState(() => new Date());

  const token = async () => (await sb.auth.getSession()).data?.session?.access_token;
  const load = useCallback(async () => {
    const from = dayStartInstant(addDaysKey(week, -1)).toISOString(); // a day either side so a shift past midnight is never cut off
    const to = dayStartInstant(addDaysKey(week, 8)).toISOString();
    const [st, sh, br, se, rq] = await Promise.all([
      sb.from('staff_users').select('id,full_name,email,role,color,active').eq('active', true).order('full_name'),
      sb.from('shifts').select('*').gte('started_at', from).lt('started_at', to).is('voided_at', null).order('started_at'),
      sb.from('shift_breaks').select('*').gte('started_at', from).lt('started_at', to).is('voided_at', null),
      sb.from('job_clock_sessions').select('id,staff_id,job_id,started_at,ended_at,voided_at').gte('started_at', from).lt('started_at', to).is('voided_at', null),
      sb.from('shift_edit_requests').select('*').eq('status', 'pending').order('created_at'),
    ]);
    const bad = [sh, rq].find((r) => r.error);
    if (bad) { setData({ loading: false, error: /does not exist|schema cache/i.test(bad.error.message) ? 'The day clock is not set up yet. Run migration 025, then reload.' : bad.error.message }); return; }
    setData({ loading: false, staff: st.data || [], shifts: sh.data || [], breaks: br.data || [], sessions: se.data || [] });
    setRequests(rq.data || []);
  }, [sb, week]);
  useEffect(() => { load(); }, [load]);

  const keys = useMemo(() => weekKeys(week), [week]);
  const people = useMemo(() => {
    if (!data.staff) return [];
    return data.staff.map((p) => {
      const mine = (x) => x.filter((r) => (r.staff_id) === p.id);
      const days = dayRows({ shifts: mine(data.shifts), breaks: mine(data.breaks), sessions: mine(data.sessions), role: p.role, now })
        .filter((d) => keys.includes(d.date));
      return { ...p, name: staffName(p), days, net: days.reduce((n, d) => n + d.netMinutes, 0), jobs: days.reduce((n, d) => n + d.jobMinutes, 0), flags: days.reduce((n, d) => n + d.flags.filter((f) => f.level === 'warn').length, 0) };
    }).filter((p) => p.days.length > 0 || p.role === 'tech');
  }, [data, keys, now]);
  const nameOf = (id) => (data.staff || []).find((p) => p.id === id);

  async function call(path, method, body, key) {
    setBusy(key); setMsg(null);
    try { await apiFetch(path, await token(), { method, body: JSON.stringify(body) }); await load(); return true; }
    catch (e) { setMsg({ err: true, text: e.message }); return false; }
    finally { setBusy(''); }
  }
  const decide = (r, decision) => call(`/api/shifts/requests/${r.id}`, 'POST', { decision, note: notes[r.id] || '' }, r.id);
  async function saveEdit(e) {
    e.preventDefault();
    const body = { started_at: fromLocalInput(edit.started), ended_at: fromLocalInput(edit.ended) };
    const ok = edit.add ? await call('/api/shifts', 'POST', { action: 'add', staff_id: edit.staffId, ...body, reason: 'Added by the owner' }, 'edit')
      : await call(`/api/shifts/${edit.shiftId}`, 'PATCH', { ...body, break_id: edit.breakId }, 'edit');
    if (ok) setEdit(null);
  }
  const voidIt = (shiftId, breakId) => { if (window.confirm(breakId ? 'Remove this break?' : 'Remove this shift and its breaks?')) call(`/api/shifts/${shiftId}`, 'PATCH', { void: true, break_id: breakId }, shiftId); };
  function download() {
    const csv = shiftsCsv(people.map((p) => ({ name: p.name, days: p.days })), now);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `time-clock-${week}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  if (data.loading) return <p className="muted">Loading the time clock...</p>;
  if (data.error) return <div className="msg err" role="alert">{data.error}</div>;
  return (
    <>
      {requests.length > 0 && (
        <section className="card" aria-label="Changes waiting for approval">
          <h2 style={{ marginTop: 0 }}>Changes waiting for you <span className="tab-count warn">{requests.length}</span></h2>
          {requests.map((r) => (
            <div key={r.id} className="cp-req">
              <div className="cp-main">
                <strong>{staffName(nameOf(r.requested_by) || {})}</strong> asks to {r.target === 'add' ? 'add' : 'change'} {REQUEST_WHAT[r.target]} on {when(dayKey(r.new_started_at))}
                <div className="cp-times">
                  {r.old_started_at ? <>Now {fmtTime(r.old_started_at)} &ndash; {fmtTime(r.old_ended_at)}. </> : null}
                  {r.old_started_at ? 'Wants' : 'Wants it recorded as'} {fmtTime(r.new_started_at)} &ndash; {fmtTime(r.new_ended_at)} ({hmWords((new Date(r.new_ended_at) - new Date(r.new_started_at)) / 60000)}).
                </div>
                <div className="cp-why">&ldquo;{r.reason}&rdquo;</div>
                <input className="tc-note" placeholder="Note back (optional)" maxLength={300} value={notes[r.id] || ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} aria-label="Note to the requester" />
              </div>
              <div className="cp-buttons">
                <button type="button" className="primary" disabled={!!busy} onClick={() => decide(r, 'approve')}>Approve</button>
                <button type="button" className="secondary" disabled={!!busy} onClick={() => decide(r, 'reject')}>Not approved</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="tc-week">
        <button type="button" className="secondary" onClick={() => setWeek(addDaysKey(week, -7))}>&larr; Earlier</button>
        <strong>{when(keys[0])} &ndash; {when(keys[6])}</strong>
        <button type="button" className="secondary" onClick={() => setWeek(addDaysKey(week, 7))} disabled={addDaysKey(week, 7) > dayKey(now)}>Later &rarr;</button>
        <button type="button" className="secondary" onClick={() => setWeek(weekStartKey(dayKey(now)))}>This week</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="secondary" onClick={() => setEdit({ add: true, staffId: people[0]?.id || '', started: toLocalInput(dayStartInstant(dayKey(now)).toISOString()), ended: toLocalInput(new Date().toISOString()) })}>Add a shift</button>
        <button type="button" className="secondary" onClick={download} disabled={!people.some((p) => p.days.length)}>Download CSV</button>
      </div>
      {msg && <div className={`msg${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'}>{msg.text}</div>}

      {edit && (
        <form className="card tc-edit" onSubmit={saveEdit}>
          {edit.add && <label>Person<select value={edit.staffId} onChange={(e) => setEdit({ ...edit, staffId: e.target.value })}>{(data.staff || []).map((p) => <option key={p.id} value={p.id}>{staffName(p)}</option>)}</select></label>}
          <label>Start<input type="datetime-local" value={edit.started} onChange={(e) => setEdit({ ...edit, started: e.target.value })} required /></label>
          <label>End<input type="datetime-local" value={edit.ended} onChange={(e) => setEdit({ ...edit, ended: e.target.value })} required /></label>
          <button type="submit" className="primary" disabled={busy === 'edit'}>Save</button>
          <button type="button" className="secondary" onClick={() => setEdit(null)}>Cancel</button>
        </form>
      )}

      {people.map((p) => (
        <section key={p.id} className="card tc-person">
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <div><h2 style={{ margin: 0 }}><span aria-hidden style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 6, background: colorFor(p.color).hex || '#888', marginRight: 8 }} />{p.name}</h2>{p.email && <div className="muted" style={{ fontSize: 13 }}>{p.email}</div>}</div>
            <div className="muted"><span className="tc-total">{hmText(p.net)}</span> worked &middot; {hmText(p.jobs)} on jobs{p.flags > 0 && <span className="tab-count warn" style={{ marginLeft: 8 }} title="Things that do not add up">{p.flags}</span>}</div>
          </div>
          {p.days.length === 0 && <p className="muted">No shifts this week.</p>}
          {p.days.slice().reverse().map((d) => (
            <div key={d.date} className="tc-day">
              <div className="tc-line"><strong>{when(d.date)}</strong><span className="muted">{hmText(d.netMinutes)} worked, {hmText(d.jobMinutes)} on jobs</span></div>
              {d.shifts.map(({ shift, breaks: bs, net }) => (
                <div key={shift.id} className="tc-line">
                  <span>{fmtTime(shift.started_at)} &ndash; {shift.ended_at ? fmtTime(shift.ended_at) : <em>still clocked in</em>} ({hmText(net)}){shift.edited_at ? ' (changed)' : ''}</span>
                  <button type="button" className="link" onClick={() => setEdit({ shiftId: shift.id, started: toLocalInput(shift.started_at), ended: shift.ended_at ? toLocalInput(shift.ended_at) : '' })}>Edit</button>
                  <button type="button" className="link" onClick={() => voidIt(shift.id)}>Remove</button>
                  {bs.map((b) => (
                    <span key={b.id} className="muted" style={{ flexBasis: '100%', paddingLeft: 14 }}>
                      Break {fmtTime(b.started_at)} &ndash; {b.ended_at ? fmtTime(b.ended_at) : 'open'}{' '}
                      <button type="button" className="link" onClick={() => setEdit({ shiftId: shift.id, breakId: b.id, started: toLocalInput(b.started_at), ended: b.ended_at ? toLocalInput(b.ended_at) : '' })}>Edit</button>{' '}
                      <button type="button" className="link" onClick={() => voidIt(shift.id, b.id)}>Remove</button>
                    </span>
                  ))}
                </div>
              ))}
              {d.flags.map((f, i) => <div key={i} className={`tc-flag ${f.level}`}>{f.level === 'warn' ? 'Check: ' : 'Note: '}{f.text}</div>)}
            </div>
          ))}
        </section>
      ))}
      {people.length === 0 && <p className="muted">No one has clocked in this week.</p>}
    </>
  );
}
