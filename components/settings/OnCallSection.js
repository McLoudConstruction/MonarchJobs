'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { staffName } from '@/lib/userDisplay';
import { fromLocalInput, fmtDateTime } from '@/lib/format';
import { validateOnCall, handoffLabel, bestOrder, rotationConflicts } from '@/lib/onCall';
import OnCallCalendar from '@/components/settings/OnCallCalendar';
import SwapRequests from '@/components/settings/SwapRequests';
import SaveButton from '@/components/SaveButton';
import { useSaveStatus } from '@/lib/saveStatus';

const COLUMNS = 'timezone,oncall_enabled,oncall_order,oncall_start,oncall_handoff_hour,oncall_wait_minutes';
const WEEKS_AHEAD = 26;
const mondayOnOrAfter = (d = new Date()) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + ((8 - x.getDay()) % 7));
  return x.toLocaleDateString('en-CA');
};
const h3 = { marginTop: 28, marginBottom: 10 };

// Owner and office: who is in the on-call rotation, in what order, how long to wait before an unclaimed emergency lead goes further,
// a calendar of who is on call (with time off flagged), and swaps.
export default function OnCallSection() {
  const [f, setF] = useState(null);
  const [missing, setMissing] = useState(false);
  const [people, setPeople] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [swaps, setSwaps] = useState([]);
  const [swap, setSwap] = useState({ staff_id: '', from: '', to: '' });
  const [msg, setMsg] = useState(null);
  const [suggest, setSuggest] = useState(null);
  const [sub, setSub] = useState('setup'); // setup | calendar
  const [waiting, setWaiting] = useState(0);
  const saveS = useSaveStatus();

  const load = useCallback(async () => {
    const sb = getSupabase();
    const since = new Date(Date.now() - 45 * 86400000).toLocaleDateString('en-CA');
    const w = await sb.from('oncall_swap_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    setWaiting((cur) => { const n = w.error ? 0 : w.count || 0; if (cur === 0 && n > 0) setSub('calendar'); return n; });
    const [s, p, t, o] = await Promise.all([
      sb.from('settings').select(COLUMNS).eq('id', 1).maybeSingle(),
      sb.from('staff_users').select('id,full_name,email,role,color,created_at').eq('active', true).order('full_name'),
      sb.from('time_off').select('staff_id,starts_on,ends_on').gte('ends_on', since).limit(500),
      sb.from('oncall_overrides').select('id,staff_id,starts_at,ends_at,created_at').gt('ends_at', new Date(Date.now() - 45 * 86400000).toISOString()).order('starts_at'),
    ]);
    if (s.error || !s.data) { setMissing(true); return; }
    setF((cur) => cur || { ...s.data, oncall_order: s.data.oncall_order || [], oncall_start: s.data.oncall_start || '' });
    setPeople(p.data || []);
    setTimeOff(t.data || []);
    setSwaps(o.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const cfg = useMemo(() => (f ? { ...f, tz: f.timezone || undefined, timeOff, overrides: swaps, isActive: (id) => people.some((p) => p.id === id) } : null), [f, timeOff, swaps, people]);
  const stats = useMemo(() => (f && f.oncall_order.length && f.oncall_start ? rotationConflicts(f.oncall_order, f.oncall_start, timeOff, WEEKS_AHEAD) : null), [f, timeOff]);

  if (missing) return <div className="card"><h2>On call</h2><p className="muted">This needs database update 047. Run it in Supabase, then reload.</p></div>;
  if (!f) return <div className="card"><p className="muted">Loading...</p></div>;

  const nameOf = (id) => { const x = people.find((q) => q.id === id); return x ? staffName(x) : 'Former staff member'; };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const inRotation = (id) => f.oncall_order.includes(id);
  const toggle = (id) => {
    setSuggest(null);
    if (inRotation(id)) setF({ ...f, oncall_order: f.oncall_order.filter((x) => x !== id) });
    else setF({ ...f, oncall_order: [...f.oncall_order, id], oncall_start: f.oncall_start || mondayOnOrAfter() });
  };
  const move = (i, d) => { const o = [...f.oncall_order]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; setSuggest(null); setF({ ...f, oncall_order: o }); };
  const n = f.oncall_order.length;
  const others = people.filter((p) => !inRotation(p.id));

  function suggestBest() {
    const start = f.oncall_start || mondayOnOrAfter();
    const r = bestOrder(f.oncall_order, start, timeOff, WEEKS_AHEAD);
    const before = rotationConflicts(f.oncall_order, start, timeOff, WEEKS_AHEAD);
    setF({ ...f, oncall_order: r.order, oncall_start: start });
    setSuggest({ before, after: r });
  }

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
      <div className="tabs">
        <button type="button" className={sub === 'setup' ? 'on' : ''} onClick={() => setSub('setup')}>Set up</button>
        <button type="button" className={sub === 'calendar' ? 'on' : ''} onClick={() => setSub('calendar')}>{waiting ? `Calendar and swaps (${waiting})` : 'Calendar and swaps'}</button>
      </div>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      {sub === 'setup' && <form onSubmit={saveS.track(save)}>
        <div className="field"><label className="row"><input type="checkbox" checked={!!f.oncall_enabled} onChange={set('oncall_enabled')} /> Turn on the on-call alerts</label></div>
        <div className="grid2" style={{ gap: 12 }}>
          <div className="field" style={{ margin: 0 }}><label>Rotation starts the week of (a Monday)</label><input type="date" value={f.oncall_start} onChange={set('oncall_start')} /></div>
          <div className="field" style={{ margin: 0 }}><label>Week changes over at (hour)</label>
            <select value={f.oncall_handoff_hour} onChange={set('oncall_handoff_hour')}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{handoffLabel(h)}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}><label>Wait before passing it on (minutes)</label><input type="number" min="5" max="120" value={f.oncall_wait_minutes} onChange={set('oncall_wait_minutes')} /></div>
        </div>

        <h3 style={h3}>Who is in the rotation</h3>
        <p className="hint" style={{ marginTop: 0 }}>Tick the people who take a week. Weeks go in the order shown.</p>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {f.oncall_order.map((id, i) => (
            <li key={id} className="row" style={{ gap: 10, padding: '6px 0', borderTop: i ? '1px solid var(--border)' : 'none', alignItems: 'center' }}>
              <input type="checkbox" checked onChange={() => toggle(id)} aria-label={`${nameOf(id)} is in the rotation`} />
              <span style={{ minWidth: 70, color: 'var(--muted)' }}>Week {i + 1}</span>
              <span style={{ flex: 1 }}>{nameOf(id)}</span>
              <button type="button" className="secondary" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>Up</button>
              <button type="button" className="secondary" aria-label="Move down" disabled={i === n - 1} onClick={() => move(i, 1)}>Down</button>
            </li>
          ))}
          {others.map((p, i) => (
            <li key={p.id} className="row" style={{ gap: 10, padding: '6px 0', borderTop: n || i ? '1px solid var(--border)' : 'none', alignItems: 'center', opacity: 0.8 }}>
              <input type="checkbox" checked={false} onChange={() => toggle(p.id)} aria-label={`Add ${staffName(p)} to the rotation`} />
              <span style={{ flex: 1 }}>{staffName(p)}</span>
            </li>
          ))}
        </ol>

        {n > 0 && (
          <div style={{ marginTop: 14 }}>
            <p style={{ margin: '0 0 4px' }}><strong>{n}-week rotation.</strong> {n === 1 ? 'The same person is on call every week.' : `Each person is on call 1 week out of every ${n}.`}</p>
            {stats && <p className="hint" style={{ margin: '0 0 8px' }}>{stats.weeksHit === 0 ? `No time off falls on anyone's on-call week in the next ${WEEKS_AHEAD} weeks.` : `${stats.weeksHit} of the next ${WEEKS_AHEAD} weeks fall on the on-call person's own time off (the next person covers those days).`}</p>}
            <button type="button" className="secondary" disabled={n < 2} onClick={suggestBest}>Suggest the best order</button>
            {suggest && (
              <p className="hint" style={{ margin: '8px 0 0' }}>
                {suggest.after.weeksHit === suggest.before.weeksHit && suggest.after.daysHit === suggest.before.daysHit
                  ? 'This order already avoids as much time off as any other order can, so nothing moved.'
                  : `Reordered: weeks that hit someone's time off went from ${suggest.before.weeksHit} to ${suggest.after.weeksHit} over the next ${WEEKS_AHEAD} weeks. Save to keep it.`}
              </p>
            )}
          </div>
        )}
        <p className="hint" style={{ margin: '12px 0' }}>Times use {f.timezone || 'America/Chicago'}. Save to apply changes. The Calendar tab shows your unsaved changes.</p>
        <div className="row" style={{ marginBottom: 8, gap: 8 }}>
          <SaveButton save={saveS} idle="Save on-call settings" className="primary" />
          <button type="button" className="secondary" onClick={() => setSub('calendar')}>See the calendar</button>
        </div>
      </form>}

      {sub === 'calendar' && <>
      <SwapRequests people={people} onChanged={load} />
      <p className="hint" style={{ marginTop: 0 }}>Shows your changes from Set up even before you save them.</p>
      <OnCallCalendar cfg={cfg} people={people} />

      <h3 style={h3}>Swaps</h3>
      <p className="hint">Someone covering a stretch of time instead of the rotation, for example a night off.</p>
      {swaps.filter((s) => new Date(s.ends_at) > new Date()).length === 0 && <p className="muted">No swaps coming up.</p>}
      <ul>
        {swaps.filter((s) => new Date(s.ends_at) > new Date()).map((s) => (
          <li key={s.id} className="row" style={{ gap: 8 }}>
            <span>{nameOf(s.staff_id)}: {fmtDateTime(s.starts_at)} to {fmtDateTime(s.ends_at)}</span>
            <button type="button" className="danger" onClick={() => removeSwap(s.id)}>Remove</button>
          </li>
        ))}
      </ul>
      <form onSubmit={addSwap} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <select style={{ flex: '1 1 100%', minWidth: 0 }} value={swap.staff_id} onChange={(e) => setSwap({ ...swap, staff_id: e.target.value })} aria-label="Who covers">
          <option value="">Who covers...</option>
          {people.map((p) => <option key={p.id} value={p.id}>{staffName(p)}</option>)}
        </select>
        <input style={{ flex: '1 1 220px', minWidth: 0 }} type="datetime-local" aria-label="From" value={swap.from} onChange={(e) => setSwap({ ...swap, from: e.target.value })} />
        <input style={{ flex: '1 1 220px', minWidth: 0 }} type="datetime-local" aria-label="To" value={swap.to} onChange={(e) => setSwap({ ...swap, to: e.target.value })} />
        <button type="submit" className="secondary">Add swap</button>
      </form>
      </>}
    </div>
  );
}
