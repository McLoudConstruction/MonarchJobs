'use client';
// Make, copy and turn off the read-only adjuster links for a job (office and owner).
import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { fmtDateTime } from '@/lib/format';

export default function AdjusterLink({ jobId, onClose }) {
  const [links, setLinks] = useState(null);
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState('');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().from('adjuster_links').select('id,token,label,expires_at,revoked_at,created_at,last_viewed_at,view_count').eq('job_id', jobId).order('created_at', { ascending: false });
    if (error) { setMsg(error.message); setLinks([]); return; }
    setLinks(data || []);
  }, [jobId]);
  useEffect(() => { load(); }, [load]);

  async function make() {
    setMsg('');
    const { error } = await getSupabase().from('adjuster_links').insert({ job_id: jobId, label: label.trim().slice(0, 80) });
    if (error) { setMsg(error.message); return; }
    setLabel('');
    load();
  }
  async function revoke(id) {
    if (!window.confirm('Turn this link off? Anyone who has it will no longer be able to open it.')) return;
    await getSupabase().from('adjuster_links').update({ revoked_at: new Date().toISOString() }).eq('id', id);
    load();
  }
  async function copy(l) {
    const url = `${origin}/a/${l.token}`;
    try { await navigator.clipboard.writeText(url); setMsg('Link copied.'); } catch { setMsg(url); }
  }
  const live = (l) => !l.revoked_at && Date.parse(l.expires_at) > Date.now();

  return (
    <div className="sketch-modal" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sketch-modal-card adj-links" role="dialog" aria-label="Adjuster links">
        <div className="sketch-pop-head"><strong>Adjuster link</strong><button type="button" className="sk-x" aria-label="Close" onClick={onClose}>{'×'}</button></div>
        <p className="muted" style={{ margin: 0 }}>A read-only page of the readings, equipment and dehumidifier performance. It shows no staff names, notes or photos, and stops working after 90 days or when you turn it off.</p>
        <label className="sk-field">Who it is for (optional)
          <input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="Carrier and claim number" />
        </label>
        <button type="button" className="primary" onClick={make}>Make a new link</button>
        {msg && <div className="msg">{msg}</div>}
        {links && links.length > 0 && (
          <ul className="adj-link-list">
            {links.map((l) => (
              <li key={l.id} className={live(l) ? '' : 'off'}>
                <div><strong>{l.label || 'Adjuster link'}</strong> <span className="muted">{live(l) ? `expires ${fmtDateTime(l.expires_at)}` : l.revoked_at ? 'turned off' : 'expired'}</span></div>
                <div className="muted">{l.view_count ? `Opened ${l.view_count} time${l.view_count === 1 ? '' : 's'}, last ${fmtDateTime(l.last_viewed_at)}` : 'Not opened yet'}</div>
                {live(l) && <div className="row"><button type="button" className="secondary small" onClick={() => copy(l)}>Copy link</button><a className="secondary small" href={`${origin}/a/${l.token}?preview=1`} target="_blank" rel="noreferrer">Preview</a><button type="button" className="danger small" onClick={() => revoke(l.id)}>Turn off</button></div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
