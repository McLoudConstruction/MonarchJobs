'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';

// Office and owner, on a finished job: offer a visit to past customers on the same street. The list is a preview; nothing
// goes out until Send is tapped. Hidden unless the owner turned "On your street offers" on in Settings.
export default function StreetOffersCard({ jobId, token }) {
  const [enabled, setEnabled] = useState(false);
  const [data, setData] = useState(null);   // preview: { items, skipped, overflow }
  const [ticked, setTicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [sentDone, setSentDone] = useState(false);

  useEffect(() => {
    getSupabase().from('settings').select('street_offers_enabled').eq('id', 1).maybeSingle().then(({ data: s, error }) => {
      if (!error && s?.street_offers_enabled) setEnabled(true);
    });
  }, []);
  if (!enabled) return null;

  async function look() {
    setBusy(true); setMsg(null); setSentDone(false);
    try {
      const r = await apiFetch(`/api/jobs/${jobId}/street-offers`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview' }) });
      if (r.error) { setMsg({ err: true, text: r.error }); setData(null); }
      else { setData(r); setTicked(Object.fromEntries((r.items || []).map((i) => [i.customer_id, true]))); }
    } catch (e) { setMsg({ err: true, text: e.message }); }
    setBusy(false);
  }

  async function send() {
    const ids = Object.keys(ticked).filter((k) => ticked[k]);
    if (!ids.length) { setMsg({ err: true, text: 'Tick at least one person.' }); return; }
    if (!window.confirm(`Send this offer to ${ids.length} ${ids.length === 1 ? 'person' : 'people'} now?`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch(`/api/jobs/${jobId}/street-offers`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', customer_ids: ids }) });
      if (r.error) setMsg({ err: true, text: r.error });
      else {
        setSentDone(true); setData(null);
        const bad = r.failed?.length ? ` ${r.failed.length} could not be reached (check Texting and Email in Integrations).` : '';
        setMsg({ err: r.sent === 0, text: `Sent to ${r.sent}.${bad}` });
      }
    } catch (e) { setMsg({ err: true, text: e.message }); }
    setBusy(false);
  }

  return (
    <div className="card">
      <h2>On your street</h2>
      <p className="hint">Offer a visit to past customers on this street. You see the list first and choose who gets it. The message does not name this customer or the street.</p>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      {!data && !sentDone && <button type="button" className="secondary" disabled={busy} onClick={look}>{busy ? 'Checking...' : 'Who lives nearby?'}</button>}
      {data && (
        <>
          {data.items.length === 0 ? <p className="muted">Nobody on this street qualifies right now.</p> : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {data.items.map((i) => (
                <li key={i.customer_id}>
                  <label className="row" style={{ gap: 8 }}>
                    <input type="checkbox" checked={!!ticked[i.customer_id]} onChange={(e) => setTicked({ ...ticked, [i.customer_id]: e.target.checked })} />
                    {i.name} <span className="muted">{i.house}{!i.phone && !i.email ? ' · no contact' : ''}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {data.overflow > 0 && <p className="hint">{data.overflow} more qualify. The batch is capped in Settings; send this one, then check again.</p>}
          {data.skipped.length > 0 && <p className="hint">Left out: {data.skipped.map((s) => `${s.name} (${s.label.toLowerCase()})`).join(', ')}.</p>}
          <div className="row">
            {data.items.length > 0 && <button type="button" className="primary" disabled={busy} onClick={send}>{busy ? 'Sending...' : 'Send offer'}</button>}
            <button type="button" className="secondary" disabled={busy} onClick={() => { setData(null); setMsg(null); }}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
