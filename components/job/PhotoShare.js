'use client';
// Selected photos -> a progress update draft, or a customer share link (office and owner).
import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { fmtDateTime } from '@/lib/format';
import { addPhotosToUpdate, addToUpdateText, expiryFromDays, sharablePhotoIds, shareState, shareStateText, shareUrl, SHARE_DAYS, SHARE_MAX_PHOTOS } from '@/lib/photoShare';
import { saveNewUpdate } from '@/lib/offlineActions';

// Put the picked photos in an existing draft update, or start a new draft with them.
export function AddToUpdatePanel({ jobId, pickedIds, drafts, onDone, onCancel, logEvent }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  async function addTo(draft) {
    setBusy(true); setMsg(null);
    try {
      if (draft) {
        const r = addPhotosToUpdate(draft.photo_ids, pickedIds);
        if (r.added) {
          const { error } = await getSupabase().from('job_updates').update({ photo_ids: r.ids }).eq('id', draft.id);
          if (error) throw new Error(error.message);
          await logEvent?.('photos_added_to_update', { count: r.added });
        }
        setMsg({ text: addToUpdateText(r) });
      } else {
        const r = addPhotosToUpdate([], pickedIds);
        const res = await saveNewUpdate({ jobId, eventKind: 'progress_update_saved', row: { kind: 'progress', status: 'draft', category: '', title: '', body: '', next_steps: '', photo_ids: r.ids } });
        if (!res.queued) await logEvent?.('progress_update_saved', { category: '' });
        setMsg({ text: `Started a new draft update with ${r.added} ${r.added === 1 ? 'photo' : 'photos'}.${r.full ? ` ${r.full} did not fit.` : ''}` });
      }
      await onDone();
    } catch (e) { setMsg({ err: true, text: e.message || 'That did not work. Try again.' }); }
    setBusy(false);
  }
  return (
    <div className="ph-panel" role="region" aria-label="Add to a progress update">
      <strong>Add {pickedIds.length} {pickedIds.length === 1 ? 'photo' : 'photos'} to an update</strong>
      <div className="ph-panel-list">
        {drafts.map((d) => (
          <button key={d.id} type="button" className="secondary" disabled={busy} onClick={() => addTo(d)}>
            {d.title || (d.body ? `${d.body.slice(0, 40)}${d.body.length > 40 ? '…' : ''}` : 'Untitled draft')} <span className="muted">({(d.photo_ids || []).length} photos)</span>
          </button>
        ))}
        <button type="button" className="primary" disabled={busy} onClick={() => addTo(null)}>Start a new draft update</button>
      </div>
      {drafts.length === 0 && <p className="hint" style={{ margin: 0 }}>No draft updates yet. A new one is started for you. Customers only get it when you send it from the Updates tab.</p>}
      {msg && <span className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</span>}
      <button type="button" className="secondary small" onClick={onCancel}>Close</button>
    </div>
  );
}

// Make, copy and switch off customer photo links. pickedIds may be empty (then it only lists links).
export function ShareLinkDialog({ jobId, pickedIds, photos, onClose, onMade, logEvent }) {
  const [links, setLinks] = useState(null);
  const [title, setTitle] = useState('');
  const [days, setDays] = useState(30);
  const [captions, setCaptions] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const ids = sharablePhotoIds(pickedIds, photos);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().from('photo_shares').select('id,token,title,photo_ids,show_captions,expires_at,revoked_at,view_count,last_viewed_at,created_at').eq('job_id', jobId).order('created_at', { ascending: false });
    if (error) { setMsg(/does not exist|schema cache/i.test(error.message) ? 'Photo links are not set up yet. Run migration 037, then reload.' : error.message); setLinks([]); return; }
    setLinks(data || []);
  }, [jobId]);
  useEffect(() => { load(); }, [load]);

  async function make() {
    if (!ids.length) { setMsg('Pick at least one photo first.'); return; }
    setBusy(true); setMsg('');
    const { data, error } = await getSupabase().from('photo_shares').insert({ job_id: jobId, title: title.trim().slice(0, 120), photo_ids: ids, show_captions: captions, expires_at: expiryFromDays(days) }).select('token').single();
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    await logEvent?.('photo_link_made', { count: ids.length });
    try { await navigator.clipboard.writeText(shareUrl(origin, data.token)); setMsg('Link made and copied.'); } catch { setMsg(shareUrl(origin, data.token)); }
    setTitle('');
    onMade?.();
    load();
  }
  async function turnOff(l) {
    if (!window.confirm('Switch this link off? Anyone who has it will no longer be able to open it.')) return;
    const { error } = await getSupabase().from('photo_shares').update({ revoked_at: new Date().toISOString() }).eq('id', l.id);
    if (error) setMsg(error.message);
    else await logEvent?.('photo_link_off', {});
    load();
  }
  async function copy(l) {
    const url = shareUrl(origin, l.token);
    try { await navigator.clipboard.writeText(url); setMsg('Link copied.'); } catch { setMsg(url); }
  }

  return (
    <div className="sketch-modal" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sketch-modal-card adj-links" role="dialog" aria-label="Photo links for the customer">
        <div className="sketch-pop-head"><strong>Photo link for the customer</strong><button type="button" className="sk-x" aria-label="Close" onClick={onClose}>{'×'}</button></div>
        <p className="muted" style={{ margin: 0 }}>A page of the photos you picked. It shows no location, tags, voice notes or staff names. It stops working on its date or when you switch it off.</p>
        {pickedIds.length > 0 && (
          <>
            <p style={{ margin: 0 }}><strong>{ids.length}</strong> {ids.length === 1 ? 'photo' : 'photos'} will be in the link{pickedIds.length > ids.length ? ` (${pickedIds.length - ids.length} left out: waiting, archived, or over the ${SHARE_MAX_PHOTOS} limit)` : ''}.</p>
            <label className="sk-field">Title (optional)
              <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Kitchen after drying" />
            </label>
            <label className="sk-field">Works for
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>{SHARE_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}</select>
            </label>
            <label className="cost-toggle"><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Show the captions I wrote</label>
            <button type="button" className="primary" disabled={busy || !ids.length} onClick={make}>Make link and copy it</button>
          </>
        )}
        {msg && <div className="msg">{msg}</div>}
        {links && links.length > 0 && (
          <ul className="adj-link-list">
            {links.map((l) => {
              const st = shareState(l);
              return (
                <li key={l.id}>
                  <div><strong>{l.title || 'Photos'}</strong> · {l.photo_ids.length} {l.photo_ids.length === 1 ? 'photo' : 'photos'} · {shareStateText(st)}</div>
                  <div className="muted">Made {fmtDateTime(l.created_at)} · works until {fmtDateTime(l.expires_at)} · opened {l.view_count} {l.view_count === 1 ? 'time' : 'times'}</div>
                  {st === 'live' && <div className="row"><button type="button" className="secondary small" onClick={() => copy(l)}>Copy link</button><a className="secondary small" href={`${origin}/p/${l.token}?preview=1`} target="_blank" rel="noreferrer">Preview</a><button type="button" className="danger small" onClick={() => turnOff(l)}>Switch off</button></div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
