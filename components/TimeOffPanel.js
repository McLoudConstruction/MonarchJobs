'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { staffName } from '@/lib/userDisplay';
import { cleanTimeOff, overlapsExisting, rangeLabel } from '@/lib/timeOff';

// Office and owner: who is off, and which days. The scheduler warns before booking someone on a day off, and
// (if turned on in Settings, Booking) online booking counts only the techs who are in.
export default function TimeOffPanel({ techs, staff }) {
  const [rows, setRows] = useState([]);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState({ staff_id: '', starts_on: '', ends_on: '', note: '' });
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState([]);
  const [reply, setReply] = useState({});

  const load = useCallback(async () => {
    const today = new Date().toLocaleDateString('en-CA');
    const { data, error } = await getSupabase().from('time_off').select('id,staff_id,starts_on,ends_on,note').gte('ends_on', today).order('starts_on').limit(300);
    if (error) { setMissing(true); return; }
    setMissing(false);
    setRows(data || []);
    const q = await getSupabase().from('time_off_requests').select('id,staff_id,starts_on,ends_on,note,created_at').eq('status', 'pending').order('created_at');
    setPending(q.error ? [] : q.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const nameOf = (id) => { const t = techs.find((x) => x.id === id); return t ? staffName(t) : 'Former staff member'; };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function add(e) {
    e.preventDefault();
    setMsg(null);
    const c = cleanTimeOff(form);
    if (c.error) { setMsg({ err: true, text: c.error }); return; }
    if (overlapsExisting(rows, c.value)) { setMsg({ err: true, text: 'This person already has time off on some of those days. Remove the other entry first.' }); return; }
    setSaving(true);
    const { error } = await getSupabase().from('time_off').insert({ ...c.value, created_by: staff?.id || null });
    setSaving(false);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setForm({ staff_id: form.staff_id, starts_on: '', ends_on: '', note: '' });
    setMsg({ err: false, text: 'Saved.' });
    load();
  }
  async function decide(r, approve) {
    setMsg(null);
    const { error } = await getSupabase().rpc('time_off_decide', { p_id: r.id, p_approve: approve, p_note: (reply[r.id] || '').trim() });
    if (error) { setMsg({ err: true, text: error.message.includes('ALREADY_DECIDED') ? 'Someone already answered that request.' : error.message }); }
    else setMsg({ err: false, text: approve ? 'Approved. It is on the time off list.' : 'Declined. They have been told.' });
    load();
  }
  async function remove(r) {
    if (!window.confirm(`Remove time off for ${nameOf(r.staff_id)} (${rangeLabel(r)})?`)) return;
    const { error } = await getSupabase().from('time_off').delete().eq('id', r.id);
    if (error) setMsg({ err: true, text: error.message }); else load();
  }

  if (missing) return <div className="card"><p className="hint">Time off needs the latest database update (045). Run it in Supabase, then reload.</p></div>;

  return (
    <>
    {pending.length > 0 && (
      <div className="card">
        <h2>Requests waiting ({pending.length})</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {pending.map((r) => (
            <li key={r.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
              <div><strong>{nameOf(r.staff_id)}</strong> · {rangeLabel(r)}{r.note ? ` · ${r.note}` : ''}</div>
              <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <input style={{ flex: '1 1 220px', minWidth: 0 }} aria-label="Reply (optional)" placeholder="Reply (optional)" maxLength={200} value={reply[r.id] || ''} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })} />
                <button type="button" className="primary" onClick={() => decide(r, true)}>Approve</button>
                <button type="button" className="secondary" onClick={() => decide(r, false)}>Decline</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    )}
    <div className="card">
      <h2>Time off</h2>
      <p className="hint">Whole days. The scheduler warns before booking someone on a day off, and you can still book over it on purpose.</p>
      <form onSubmit={add} className="grid2">
        <div className="field"><label htmlFor="to-who">Who</label>
          <select id="to-who" value={form.staff_id} onChange={set('staff_id')}>
            <option value="">Choose...</option>
            {techs.filter((t) => t.role === 'tech' || t.role === 'owner').map((t) => <option key={t.id} value={t.id}>{staffName(t)}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="to-note">Note (optional)</label><input id="to-note" maxLength={200} value={form.note} onChange={set('note')} /></div>
        <div className="field"><label htmlFor="to-from">First day off</label><input id="to-from" type="date" value={form.starts_on} onChange={set('starts_on')} /></div>
        <div className="field"><label htmlFor="to-to">Last day off</label><input id="to-to" type="date" value={form.ends_on} min={form.starts_on || undefined} onChange={set('ends_on')} /><div className="note">Leave blank for a single day.</div></div>
        <div><button className="primary" disabled={saving}>{saving ? 'Saving...' : 'Add time off'}</button></div>
      </form>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      {rows.length === 0 ? <p className="muted">No upcoming time off.</p> : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {rows.map((r) => (
            <li key={r.id} className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', padding: '8px 0' }}>
              <span><strong>{nameOf(r.staff_id)}</strong> · {rangeLabel(r)}{r.note ? ` · ${r.note}` : ''}</span>
              <button type="button" className="secondary small" onClick={() => remove(r)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
    </>
  );
}
