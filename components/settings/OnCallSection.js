'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { staffName } from '@/lib/userDisplay';
import { fromLocalInput, fmtDateTime } from '@/lib/format';
import { upcomingWeeks, validateOnCall, handoffLabel } from '@/lib/onCall';
import SaveButton from '@/components/SaveButton';
import { useSaveStatus } from '@/lib/saveStatus';

const COLUMNS = 'timezone,oncall_enabled,oncall_order,oncall_start,oncall_handoff_hour,oncall_wait_minutes';
const mondayOnOrAfter = (d = new Date()) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + ((8 - x.getDay()) % 7));
  return x.toLocaleDateString('en-CA');
};

// Owner and office: who is on call each week, how long to wait before an unclaimed emergency lead goes further, and swaps.
export default function OnCallSection() {
  const [f, setF] = useState(null);
  const [missing, setMissing] = useState(false);
  const [people, setPeople] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [swaps, setSwaps] = useState([]);
  const [add, setAdd] = useState('');
  const [swap, setSwap] = useState({ staff_id: '', from: '', to: '' });
  const [msg, setMsg] = useState(null);
  const saveS = useSaveStatus();

  const load = useCallback(async () => {
    const sb = getSupabase();
    const today = new Date().toLocaleDateString('en-CA');
    const [s, p, t, o] = await Promise.all([
      sb.from('settings').select(COLUMNS).eq('id', 1).maybeSingle(),
      sb.from('staff_users').select('id,full_name,email,role').eq('active', true).order('full_name'),
      sb.from('time_off').select('staff_id,starts_on,ends_on').gte('ends_on', today).limit(300),
      sb.from('oncall_overrides').select('id,staff_id,starts_at,ends_at,created_at').gt('ends_at', new Date().toISOString()).order('starts_at'),
    ]);
    if (s.error || !s.data) { setMissing(true); return; }
    setF((cur) => cur || { ...s.data, oncall_order: s.data.oncall_order || [], oncall_start: s.data.oncall_start || '' });
    setPeople(p.data || []);
    setTimeOff(t.data || []);
    setSwaps(o.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const nameOf = (id) => { const x = people.find((q) => q.id === id); return x ? staffName(x) : 'Former staff member'; };
  const weeks = useMemo(() => (f && f.oncall_order.length && f.oncall_start
    ? upcomingWeeks(Date.now(), 8, { ...f, tz: f.timezone || undefined, timeOff, isActive: (id) => people.some((p) => p.id === id) })
    : []), [f, timeOff, people]);

  if (missing) return <div className="card"><h2>On call</h2><p className="muted">This needs database update 047. Run it in Supabase, then reload.</p></div>;
  if (!f) return <div className="card"><p className="muted">Loading...</p></div>;

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const move = (i, d) => { const o = [...f.oncall_order]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; setF({ ...f, oncall_order: o }); };
  const remove = (id) => setF({ ...f, oncall_order: f.oncall_order.filter((x) => x !== id) });
  const addPerson = () => {
    if (!add || f.oncall_order.includes(add)) return;
    setF({ ...f, oncall_order: [...f.oncall_order, add], oncall_start: f.oncall_start || mondayOnOrAfter() });
    setAdd('');
  };

  async function save(e) {
    e.preventDefault();
    const c = validateOnCall(f);
    if (c.error) { setMsg({ err: true, text: c.error }); return false; }
    const { error } = await getSupabase().from('settings').update(c.value).eq('id', 1);
    if (error) { setMsg({ err: true, text: error.message }); return false; }
    setF({ ...f, ...c.value, oncall_start: c.value.oncall_start || '' });
    setMsg({ text: 'Saved.' });
    return true;
  }

  async function addSwap(e) {
    e.preventDefault();
    setMsg(null);
    const a = fromLocalInput(swap.from); const b = fromLocalInput(swap.to);
    if (!swap.staff_id || !a || !b) { setMsg({ err: true, text: 'Pick a person and when the swap starts and ends.' }); return; }
    if (new Date(b) <= new Date(a)) { setMsg({ err: true, text: 'The swap must end after it starts.' }); return; }
    const { error } = await getSupabase().from('oncall_overrides').insert({ staff_id: swap.staff_id, starts_at: a, ends_at: b });
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setSwap({ staff_id: swap.staff_id, from: '', to: '' });
    load();
  }
  async function removeSwap(id) {
    await getSupabase().from('oncall_overrides').delete().eq('id', id);
    load();
  }

  return (
    <div className="card">
      <h2>On call</h2>
      <p className="hint">One person is on call each week. When an emergency lead comes in, they get their own alert. If nobody claims it within the wait time, the next person in the rotation and the office and owner are told. Anyone on time off is skipped.</p>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      <form onSubmit={saveS.track(save)}>
        <div className="field"><label className="row"><input type="checkbox" checked={!!f.oncall_enabled} onChange={set('oncall_enabled')} /> Turn on the on-call alerts</label></div>
        <div className="grid2">
          <div className="field"><label>Rotation starts the week of (a Monday)</label><input type="date" value={f.oncall_start} onChange={set('oncall_start')} /></div>
          <div className="field"><label>Week changes over at (hour)</label>
            <select value={f.oncall_handoff_hour} onChange={set('oncall_handoff_hour')}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{handoffLabel(h)}</option>)}
            </select>
          </div>
          <div className="field"><label>Wait before passing it on (minutes)</label><input type="number" min="5" max="120" value={f.oncall_wait_minutes} onChange={set('oncall_wait_minutes')} /></div>
        </div>

        <h3>Rotation order</h3>
        {f.oncall_order.length === 0 && <p className="muted">Nobody yet. Add people in the order they take the week.</p>}
        <ol>
          {f.oncall_order.map((id, i) => (
            <li key={id} className="row" style={{ gap: 8, margin: '4px 0' }}>
              <span style={{ minWidth: 160 }}>{nameOf(id)}</span>
              <button type="button" className="secondary" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>Up</button>
              <button type="button" className="secondary" aria-label="Move down" disabled={i === f.oncall_order.length - 1} onClick={() => move(i, 1)}>Down</button>
              <button type="button" className="danger" onClick={() => remove(id)}>Remove</button>
            </li>
          ))}
        </ol>
        <div className="row">
          <select value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Person to add">
            <option value="">Add a person...</option>
            {people.filter((p) => !f.oncall_order.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{staffName(p)}</option>)}
          </select>
          <button type="button" className="secondary" onClick={addPerson} disabled={!add}>Add</button>
        </div>
        <p className="hint">Times use {f.timezone || 'America/Chicago'}. Save to apply changes.</p>
        <SaveButton save={saveS} idle="Save on-call settings" className="primary" />
      </form>

      {weeks.length > 0 && (
        <>
          <h3>Next 8 weeks</h3>
          <table className="own-table">
            <thead><tr><th>Week of</th><th>On call</th></tr></thead>
            <tbody>
              {weeks.map((w) => <tr key={w.weekStart}><td>{new Date(`${w.weekStart}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td><td>{w.staffId ? nameOf(w.staffId) : 'Nobody available'}</td></tr>)}
            </tbody>
          </table>
        </>
      )}

      <h3>Swaps</h3>
      <p className="hint">Someone covering a stretch of time instead of the rotation, for example a night off.</p>
      {swaps.length === 0 && <p className="muted">No swaps coming up.</p>}
      <ul>
        {swaps.map((s) => (
          <li key={s.id} className="row" style={{ gap: 8 }}>
            <span>{nameOf(s.staff_id)}: {fmtDateTime(s.starts_at)} to {fmtDateTime(s.ends_at)}</span>
            <button type="button" className="danger" onClick={() => removeSwap(s.id)}>Remove</button>
          </li>
        ))}
      </ul>
      <form onSubmit={addSwap} className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <select value={swap.staff_id} onChange={(e) => setSwap({ ...swap, staff_id: e.target.value })} aria-label="Who covers">
          <option value="">Who covers...</option>
          {people.map((p) => <option key={p.id} value={p.id}>{staffName(p)}</option>)}
        </select>
        <input type="datetime-local" aria-label="From" value={swap.from} onChange={(e) => setSwap({ ...swap, from: e.target.value })} />
        <input type="datetime-local" aria-label="To" value={swap.to} onChange={(e) => setSwap({ ...swap, to: e.target.value })} />
        <button type="submit" className="secondary">Add swap</button>
      </form>
    </div>
  );
}
