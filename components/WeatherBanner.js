'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { fmtSlotDayShort } from '@/lib/booking';
import { describeAlert } from '@/lib/weather';

// Top of the schedule (office and tech): weather alerts for the business area.
//  - Freeze warning: shown to everyone, with the owner's precautions, until the warning ends.
//  - Storm alert (office and owner): open times for the next few days and a preview of a message to past customers.
//    Nothing is sent until Send is tapped.
// Shows nothing when there is no alert or the weather switches are off.
export default function WeatherBanner({ role, token }) {
  const [rows, setRows] = useState([]);
  const [hidden, setHidden] = useState({});
  const isOffice = role === 'owner' || role === 'office';

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().from('weather_alerts').select('*').in('status', ['open', 'sent']).order('created_at', { ascending: false }).limit(10);
    setRows(error ? [] : data || []); // the table arrives with migration 050
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
    const back = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [load]);

  // "Got it" hides a freeze notice on this device only; a new warning shows again.
  useEffect(() => {
    try {
      const h = {};
      for (const r of rows) if (r.kind === 'freeze' && localStorage.getItem(`wx-hide-${r.id}`)) h[r.id] = true;
      setHidden(h);
    } catch { /* storage not available: nothing is hidden */ }
  }, [rows]);
  function hide(id) {
    try { localStorage.setItem(`wx-hide-${id}`, '1'); } catch { /* ignore */ }
    setHidden((h) => ({ ...h, [id]: true }));
  }

  const freeze = rows.filter((r) => r.kind === 'freeze' && r.status === 'open' && !hidden[r.id]);
  const storms = isOffice ? rows.filter((r) => r.kind === 'storm' && r.status === 'open') : [];
  if (!freeze.length && !storms.length) return null;
  return (
    <div id="storm">
      {freeze.map((a) => {
        const d = describeAlert(a);
        return (
          <div key={a.id} className="banner" style={{ marginBottom: 8 }}>
            <strong>Freeze warning</strong>
            <div style={{ fontWeight: 400 }}>{d.line}. Please bring in or protect any equipment that is outside.</div>
            {a.note && <div style={{ fontWeight: 400, marginTop: 4 }}>{a.note}</div>}
            <div className="row" style={{ marginTop: 6 }}><button type="button" className="secondary" onClick={() => hide(a.id)}>Got it</button></div>
          </div>
        );
      })}
      {storms.map((a) => <StormCard key={a.id} alert={a} token={token} onChange={load} />)}
    </div>
  );
}

function StormCard({ alert, token, onChange }) {
  const [data, setData] = useState(null); // preview: { capacity, items, skipped, overflow, canSend, blockedReason, sample }
  const [ticked, setTicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const d = describeAlert(alert);

  async function look() {
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch(`/api/weather/${alert.id}`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview' }) });
      setData(r);
      setTicked(Object.fromEntries((r.items || []).map((i) => [i.customer_id, true])));
    } catch (e) { setMsg({ err: true, text: e.message }); }
    setBusy(false);
  }

  async function send() {
    const ids = Object.keys(ticked).filter((k) => ticked[k]);
    if (!ids.length) { setMsg({ err: true, text: 'Tick at least one person.' }); return; }
    if (!window.confirm(`Send this message to ${ids.length} ${ids.length === 1 ? 'person' : 'people'} now?`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch(`/api/weather/${alert.id}`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', customer_ids: ids }) });
      const bad = r.failed?.length ? ` ${r.failed.length} could not be reached (check Texting and Email in Integrations).` : '';
      setData(null);
      setMsg({ err: r.sent === 0, text: `Sent to ${r.sent}.${bad}` });
      if (r.sent > 0) onChange();
    } catch (e) { setMsg({ err: true, text: e.message }); }
    setBusy(false);
  }

  async function dismiss() {
    setBusy(true); setMsg(null);
    const { error } = await getSupabase().rpc('weather_alert_dismiss', { p_id: alert.id });
    setBusy(false);
    if (error) setMsg({ err: true, text: 'Could not save that. Try again.' });
    else onChange();
  }

  return (
    <div className="banner flag" style={{ marginBottom: 8 }}>
      <strong>Storm alert: {d.title}</strong>
      <div style={{ fontWeight: 400 }}>{d.line}</div>
      {d.area && <div className="hint" style={{ fontWeight: 400 }}>{d.area}</div>}
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      {!data && (
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="primary" disabled={busy} onClick={look}>{busy ? 'Checking...' : 'Check capacity and preview'}</button>
          <button type="button" className="secondary" disabled={busy} onClick={dismiss}>Not needed</button>
        </div>
      )}
      {data && (
        <div style={{ fontWeight: 400, marginTop: 8 }}>
          <strong>Open times, next {data.capacity.windowDays} days: {data.capacity.total}</strong>
          {data.capacity.perDay.length > 0 && <div className="hint">{data.capacity.perDay.map((x) => `${fmtSlotDayShort(x.date)}: ${x.open}`).join(' · ')}</div>}
          {data.blockedReason && <div className="msg err">{data.blockedReason}</div>}
          {data.items.length === 0 ? <p className="muted">Nobody qualifies for a message right now.</p> : (
            <>
              <p className="hint" style={{ marginBottom: 4 }}>Past customers, most recent first. Untick anyone you would rather not message.</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {data.items.map((i) => (
                  <li key={i.customer_id}>
                    <label className="row" style={{ gap: 8 }}>
                      <input type="checkbox" checked={!!ticked[i.customer_id]} onChange={(e) => setTicked({ ...ticked, [i.customer_id]: e.target.checked })} />
                      {i.name}{!i.phone && !i.email ? <span className="muted"> · no contact</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.overflow > 0 && <p className="hint">{data.overflow} more qualify. The batch is capped in Settings.</p>}
          {data.skipped.length > 0 && <p className="hint">Left out: {data.skipped.map((s) => `${s.count} ${s.label.toLowerCase()}`).join(', ')}.</p>}
          <p className="hint">Message: {data.sample}</p>
          <div className="row">
            {data.canSend && data.items.length > 0 && <button type="button" className="primary" disabled={busy} onClick={send}>{busy ? 'Sending...' : 'Send message'}</button>}
            <button type="button" className="secondary" disabled={busy} onClick={() => { setData(null); setMsg(null); }}>Close</button>
            <button type="button" className="secondary" disabled={busy} onClick={dismiss}>Not needed</button>
          </div>
        </div>
      )}
    </div>
  );
}
