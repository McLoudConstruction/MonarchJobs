'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { cleanTimeOffRequest, STATUS_TEXT } from '@/lib/timeRequests';
import { rangeLabel } from '@/lib/timeOff';

// A person's own time off: ask for days off, see how each request went, and see the days already approved.
export default function TimeOffTab({ staff }) {
  const [reqs, setReqs] = useState(null);
  const [approved, setApproved] = useState([]);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState({ starts_on: '', ends_on: '', note: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const today = new Date().toLocaleDateString('en-CA');
    const [r, a] = await Promise.all([
      sb.from('time_off_requests').select('id,starts_on,ends_on,note,status,decision_note,created_at').eq('staff_id', staff.id).order('created_at', { ascending: false }).limit(30),
      sb.from('time_off').select('id,starts_on,ends_on,note').eq('staff_id', staff.id).gte('ends_on', today).order('starts_on'),
    ]);
    if (r.error) { setMissing(true); return; }
    setMissing(false);
    setReqs(r.data || []);
    setApproved(a.data || []);
  }, [staff.id]);
  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    const c = cleanTimeOffRequest(form, staff.id, new Date().toLocaleDateString('en-CA'));
    if (c.error) { setMsg({ err: true, text: c.error }); return; }
    setBusy(true);
    const { staff_id: sid, ...row } = c.value;
    const { error } = await getSupabase().from('time_off_requests').insert({ staff_id: sid, ...row });
    setBusy(false);
    if (error) { setMsg({ err: true, text: 'Could not send that. Try again.' }); return; }
    setForm({ starts_on: '', ends_on: '', note: '' });
    setMsg({ err: false, text: 'Sent. You will be told when it has been reviewed.' });
    load();
  }
  async function cancel(id) {
    await getSupabase().from('time_off_requests').delete().eq('id', id);
    load();
  }

  if (missing) return <div className="card"><p className="muted">Time off requests need a database update (049). Ask the owner.</p></div>;
  return (
    <>
      <div className="card">
        <h2>Submit Time Off Request</h2>
        {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
        <form onSubmit={submit}>
          <div className="grid2" style={{ gap: 12 }}>
            <div className="field" style={{ margin: 0 }}><label>First day off</label><input type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value, ends_on: form.ends_on || e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label>Last day off</label><input type="date" value={form.ends_on} min={form.starts_on || undefined} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} /></div>
          </div>
          <div className="field"><label>Note (optional)</label><input value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Anything the office should know" /></div>
          <button className="primary" disabled={busy}>{busy ? 'Sending...' : 'Send request'}</button>
        </form>
      </div>

      <div className="card">
        <h2>My requests</h2>
        {reqs === null && <p className="muted">Loading...</p>}
        {reqs && reqs.length === 0 && <p className="muted">No requests yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {(reqs || []).map((r) => (
            <li key={r.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <strong>{rangeLabel(r)}</strong>
                <span className={`badge ${r.status === 'approved' ? 's-booked' : r.status === 'declined' ? 's-lost' : ''}`}>{STATUS_TEXT[r.status]}</span>
              </div>
              {r.note && <div className="hint">{r.note}</div>}
              {r.decision_note && <div className="hint">Reply: {r.decision_note}</div>}
              {r.status === 'pending' && <button type="button" className="secondary" style={{ marginTop: 6 }} onClick={() => cancel(r.id)}>Cancel request</button>}
            </li>
          ))}
        </ul>
      </div>

      {approved.length > 0 && (
        <div className="card">
          <h2>My days off coming up</h2>
          <ul>{approved.map((a) => <li key={a.id}>{rangeLabel(a)}{a.note ? ` · ${a.note}` : ''}</li>)}</ul>
        </div>
      )}
    </>
  );
}
