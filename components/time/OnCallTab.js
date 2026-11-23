'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { staffName } from '@/lib/userDisplay';
import { fmtDateTime, toLocalInput, fromLocalInput } from '@/lib/format';
import { myOnCallWeeks, cleanSwapRequest, STATUS_TEXT } from '@/lib/timeRequests';
import OnCallCalendar from '@/components/settings/OnCallCalendar';

const fmtWeek = (ms) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// A person's view of on call: when they are on call, who is on call each day, and a way to ask the owner for a swap.
export default function OnCallTab({ staff }) {
  const [cfg, setCfg] = useState(null);
  const [people, setPeople] = useState([]);
  const [reqs, setReqs] = useState([]);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState({ from: '', to: '', cover_id: '', note: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const since = new Date(Date.now() - 45 * 86400000);
    const [s, p, t, o, r] = await Promise.all([
      sb.from('settings').select('timezone,oncall_enabled,oncall_order,oncall_start,oncall_handoff_hour').eq('id', 1).maybeSingle(),
      sb.from('staff_users').select('id,full_name,email,role,color,created_at').eq('active', true).order('full_name'),
      sb.from('time_off').select('staff_id,starts_on,ends_on').gte('ends_on', since.toLocaleDateString('en-CA')).limit(500),
      sb.from('oncall_overrides').select('id,staff_id,starts_at,ends_at,created_at').gt('ends_at', since.toISOString()),
      sb.from('oncall_swap_requests').select('id,starts_at,ends_at,cover_id,note,status,covered_by,decision_note,created_at').eq('requester_id', staff.id).order('created_at', { ascending: false }).limit(20),
    ]);
    if (s.error || !s.data || r.error) { setMissing(true); return; }
    setMissing(false);
    const ppl = p.data || [];
    setPeople(ppl);
    setReqs(r.data || []);
    setCfg({ ...s.data, oncall_order: s.data.oncall_order || [], oncall_start: s.data.oncall_start || '', tz: s.data.timezone || undefined, timeOff: t.data || [], overrides: o.data || [], isActive: (id) => ppl.some((x) => x.id === id) });
  }, [staff.id]);
  useEffect(() => { load(); }, [load]);

  const mine = useMemo(() => (cfg && cfg.oncall_enabled ? myOnCallWeeks(staff.id, cfg, 8) : []), [cfg, staff.id]);
  const nameOf = (id) => { const x = people.find((q) => q.id === id); return x ? staffName(x) : 'Former staff member'; };

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    const c = cleanSwapRequest({ ...form, from: fromLocalInput(form.from), to: fromLocalInput(form.to) }, staff.id);
    if (c.error) { setMsg({ err: true, text: c.error }); return; }
    setBusy(true);
    const { error } = await getSupabase().from('oncall_swap_requests').insert(c.value);
    setBusy(false);
    if (error) { setMsg({ err: true, text: error.message.includes('SWAP_IN_PAST') ? 'That time has already passed.' : 'Could not send that. Try again.' }); return; }
    setForm({ from: '', to: '', cover_id: form.cover_id, note: '' });
    setMsg({ err: false, text: 'Sent to the owner. You will be told when it has been reviewed.' });
    load();
  }
  async function cancel(id) {
    await getSupabase().from('oncall_swap_requests').delete().eq('id', id);
    load();
  }

  if (missing) return <div className="card"><p className="muted">On call needs a database update (047 and 049). Ask the owner.</p></div>;
  if (!cfg) return <p className="muted">Loading...</p>;
  if (!cfg.oncall_enabled) return <div className="card"><h2>On call</h2><p className="muted">On call is not turned on yet.</p></div>;

  return (
    <>
      <div className="card">
        <h2>My on-call weeks</h2>
        {mine.length === 0 && <p className="muted">You are not on call in the weeks ahead.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {mine.map((w) => (
            <li key={w.weekStart} className="row" style={{ gap: 8, justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <span>{fmtWeek(w.startsAt)} to {fmtWeek(w.endsAt - 3600000)}</span>
              <button type="button" className="secondary" onClick={() => { setMsg(null); setForm({ ...form, from: toLocalInput(new Date(w.startsAt).toISOString()), to: toLocalInput(new Date(w.endsAt).toISOString()) }); document.getElementById('swap-form')?.scrollIntoView({ behavior: 'smooth' }); }}>Ask for a swap</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="card" id="swap-form">
        <h2>Ask for a swap</h2>
        <p className="hint">Tell the owner when you need someone else to be on call. The owner picks who covers, or uses the person you suggest.</p>
        {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
        <form onSubmit={submit}>
          <div className="grid2" style={{ gap: 12 }}>
            <div className="field" style={{ margin: 0 }}><label>From</label><input type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label>To</label><input type="datetime-local" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></div>
          </div>
          <div className="field"><label>Someone who could cover (optional)</label>
            <select value={form.cover_id} onChange={(e) => setForm({ ...form, cover_id: e.target.value })}>
              <option value="">No suggestion</option>
              {people.filter((p) => p.id !== staff.id).map((p) => <option key={p.id} value={p.id}>{staffName(p)}</option>)}
            </select>
          </div>
          <div className="field"><label>Note (optional)</label><input value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          <button className="primary" disabled={busy}>{busy ? 'Sending...' : 'Send swap request'}</button>
        </form>
      </div>

      {reqs.length > 0 && (
        <div className="card">
          <h2>My swap requests</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {reqs.map((r) => (
              <li key={r.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <strong>{fmtDateTime(r.starts_at)} to {fmtDateTime(r.ends_at)}</strong>
                  <span className={`badge ${r.status === 'approved' ? 's-booked' : r.status === 'declined' ? 's-lost' : ''}`}>{STATUS_TEXT[r.status]}</span>
                </div>
                {r.status === 'approved' && r.covered_by && <div className="hint">Covered by {nameOf(r.covered_by)}</div>}
                {r.note && <div className="hint">{r.note}</div>}
                {r.decision_note && <div className="hint">Reply: {r.decision_note}</div>}
                {r.status === 'pending' && <button type="button" className="secondary" style={{ marginTop: 6 }} onClick={() => cancel(r.id)}>Cancel request</button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>Who is on call</h2>
        <OnCallCalendar cfg={cfg} people={people} />
      </div>
    </>
  );
}
