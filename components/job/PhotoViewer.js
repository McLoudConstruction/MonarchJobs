'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSupabase } from '@/lib/supabaseClient';
import { PHOTO_BUCKET, PHOTO_KINDS, PHOTO_KIND_KEYS } from '@/lib/jobDocs';
import { useSignedUrls } from '@/lib/useSignedUrls';
import { addTag, removeTag, cleanTag, tagCounts, mapsUrl } from '@/lib/photoMeta';
import { fmtDateTime } from '@/lib/format';
import PhotoMarkup from '@/components/job/PhotoMarkup';

// Full-screen photo viewer with the controls for one photo. list is the photos being browsed,
// startId the one to open on. Changes are saved straight away and the page is refreshed through
// onChanged. Photos are archived, never deleted. rooms: the job's rooms [{ value, label }]. allPhotos: every photo on the
// job (to find a before/after partner and the tags already in use). onTakeAfter(photo) opens the camera for an "after".
export default function PhotoViewer({
  list, startId, onClose, onChanged, onAppend, authorName, jobId, fileBase, logEvent,
  rooms = [], allPhotos = [], token = null, isOffice = false, onTakeAfter = null,
}) {
  const [id, setId] = useState(startId);
  const [markup, setMarkup] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tagText, setTagText] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [moveMsg, setMoveMsg] = useState(null);

  const idx = Math.max(0, list.findIndex((p) => p.id === id));
  const photo = list[idx];
  const urls = useSignedUrls([photo?.storage_path, photo?.thumb_path]);
  const full = photo ? urls[photo.storage_path] : null;
  const thumb = photo ? urls[photo.thumb_path] : null;

  const go = useCallback((d) => {
    if (!list.length) return;
    setId(list[(idx + d + list.length) % list.length].id);
  }, [list, idx]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (markup) return undefined;
    const onKey = (e) => {
      if (/^(input|textarea|select)$/i.test(e.target.tagName)) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, markup]);

  // if the photo being shown leaves the list (archived), move on or close
  useEffect(() => {
    if (!list.length) onClose();
    else if (!list.some((p) => p.id === id)) setId(list[Math.min(idx, list.length - 1)].id);
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  const roomValue = useMemo(() => (photo?.sketch_id && photo?.room_key ? `${photo.sketch_id}|${photo.room_key}` : ''), [photo]);
  if (!photo) return null;

  async function patch(fields) {
    setErr('');
    const { error } = await getSupabase().from('job_photos').update(fields).eq('id', photo.id);
    if (error) { setErr(error.message); return false; }
    await onChanged();
    return true;
  }

  async function setRoom(v) {
    if (!v) return patch({ sketch_id: null, room_key: null });
    const [sketch_id, room_key] = v.split('|');
    return patch({ sketch_id, room_key });
  }

  async function archive(on) {
    setBusy(true);
    const ok = await patch({ archived_at: on ? new Date().toISOString() : null });
    if (ok) await logEvent(on ? 'photo_archived' : 'photo_restored', { photo_id: photo.id });
    setBusy(false);
  }

  async function saveTags(next) { return patch({ tags: next }); }
  async function submitTag() {
    const t = cleanTag(tagText);
    setTagText('');
    if (!t) return;
    await saveTags(addTag(photo.tags || [], t));
  }
  const before = photo.pair_of ? allPhotos.find((p) => p.id === photo.pair_of) : null;
  const afters = allPhotos.filter((p) => p.pair_of === photo.id && !p.archived_at);
  const suggestions = tagCounts(allPhotos).map((t) => t.tag).filter((t) => !(photo.tags || []).some((x) => x.toLowerCase() === t.toLowerCase())).slice(0, 8);
  function openPartner(p) { if (!list.some((x) => x.id === p.id)) onAppend?.(p.id, photo.id); setId(p.id); }

  async function movePhoto() {
    setMoveMsg(null);
    if (!moveTo.trim()) { setMoveMsg({ err: true, text: 'Type the job number.' }); return; }
    if (!window.confirm(`Move this photo to job #${moveTo.replace(/[^\d]/g, '')}? It leaves this job and any room it was in.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/photos/${photo.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ job_number: moveTo }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) setMoveMsg({ err: true, text: out.error || 'Could not move the photo.' });
      else { setMoveTo(''); await onChanged(); }
    } catch { setMoveMsg({ err: true, text: 'Could not move the photo. Check your signal and try again.' }); }
    setBusy(false);
  }

  async function download(path = photo.storage_path, suffix = '') {
    setErr('');
    const { data, error } = await getSupabase().storage.from(PHOTO_BUCKET).download(path);
    if (error || !data) { setErr(error?.message || 'Could not download the photo.'); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBase}-${photo.kind}-${new Date(photo.taken_at).toISOString().slice(0, 10)}-${photo.id.slice(0, 6)}${suffix}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return createPortal(
    <>
      <div className="pv-overlay" role="dialog" aria-modal="true" aria-label="Photo">
        <div className="pv-top">
          <span>{idx + 1} / {list.length}{photo.archived_at ? ' · archived' : ''}</span>
          <button type="button" className="secondary small" onClick={onClose}>Close</button>
        </div>
        <div className="pv-stage">
          {list.length > 1 && <button type="button" className="pv-nav left" aria-label="Previous photo" onClick={() => go(-1)}>&#8249;</button>}
          {(full || thumb) ? <img className="pv-img" src={full || thumb} alt={photo.caption || 'Job photo'} /> : <p style={{ color: '#fff' }}>Loading...</p>}
          {list.length > 1 && <button type="button" className="pv-nav right" aria-label="Next photo" onClick={() => go(1)}>&#8250;</button>}
        </div>
        <div className="pv-panel">
          {err && <div className="msg err" style={{ margin: 0 }}>{err}</div>}
          <div className="grid2">
            <div className="field"><label>Type</label>
              <select value={photo.kind} onChange={(e) => patch({ kind: e.target.value })}>
                {PHOTO_KIND_KEYS.map((k) => <option key={k} value={k}>{PHOTO_KINDS[k]}</option>)}
              </select>
            </div>
            <div className="field"><label>Room</label>
              <select value={roomValue} onChange={(e) => setRoom(e.target.value)}>
                <option value="">Not linked to a room</option>
                {roomValue && !rooms.some((r) => r.value === roomValue) && <option value={roomValue}>(room removed from sketch)</option>}
                {rooms.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label>Caption</label>
            <input key={photo.id + photo.caption} defaultValue={photo.caption} maxLength={500} placeholder="What this shows" onBlur={(e) => e.target.value !== photo.caption && patch({ caption: e.target.value.trim() })} />
          </div>
          <div className="field"><label>Tags</label>
            <div className="pv-tags">
              {(photo.tags || []).map((t) => (
                <span key={t} className="pv-tag">#{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => saveTags(removeTag(photo.tags, t))}>&times;</button></span>
              ))}
              <input
                value={tagText}
                maxLength={30}
                placeholder={(photo.tags || []).length ? 'Add another' : 'Add a tag (water, mold, meter...)'}
                aria-label="Add a tag"
                onChange={(e) => setTagText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); submitTag(); } }}
                onBlur={submitTag}
              />
            </div>
            {suggestions.length > 0 && (
              <div className="pv-sugg">
                {suggestions.map((t) => <button key={t} type="button" onClick={() => saveTags(addTag(photo.tags || [], t))}>+ {t}</button>)}
              </div>
            )}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Taken {fmtDateTime(photo.taken_at)}{authorName(photo.created_by) ? ` · by ${authorName(photo.created_by)}` : ''}{photo.width ? ` · ${photo.width}×${photo.height}` : ''}{photo.derived_from ? ' · marked-up copy' : ''}
            {photo.gps_lat != null && photo.gps_lng != null && (
              <> · <a href={mapsUrl(photo.gps_lat, photo.gps_lng)} target="_blank" rel="noopener noreferrer">Where it was taken{photo.gps_accuracy_m != null ? ` (within ${Math.max(1, Math.round(photo.gps_accuracy_m))} m)` : ''}</a></>
            )}
            {photo.created_at && Math.abs(new Date(photo.created_at) - new Date(photo.taken_at)) > 10 * 60 * 1000 && <> · reached the job {fmtDateTime(photo.created_at)}</>}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="secondary small" onClick={() => setMarkup(true)}>Mark up</button>
            {onTakeAfter && !photo.archived_at && <button type="button" className="secondary small" onClick={() => onTakeAfter(photo)}>Take after photo</button>}
            {before && <button type="button" className="secondary small" onClick={() => openPartner(before)}>See before photo</button>}
            {afters.map((a, i) => <button key={a.id} type="button" className="secondary small" onClick={() => openPartner(a)}>{afters.length > 1 ? `See after photo ${i + 1}` : 'See after photo'}</button>)}
            <button type="button" className="secondary small" onClick={() => download()}>Download</button>
            {photo.original_path && <button type="button" className="secondary small" onClick={() => download(photo.original_path, '-original')}>Download original</button>}
            <button type="button" className={`${photo.archived_at ? 'secondary' : 'danger'} small`} disabled={busy} onClick={() => archive(!photo.archived_at)}>
              {photo.archived_at ? 'Restore' : 'Archive'}
            </button>
          </div>
          {isOffice && (
            <details style={{ marginTop: 10 }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>Filed on the wrong job?</summary>
              <div className="row" style={{ marginTop: 8 }}>
                <input value={moveTo} onChange={(e) => setMoveTo(e.target.value)} inputMode="numeric" placeholder="Job number" aria-label="Job number to move to" style={{ width: 130 }} />
                <button type="button" className="secondary small" disabled={busy} onClick={movePhoto}>Move photo</button>
              </div>
              {moveMsg && <div className={`msg ${moveMsg.err ? 'err' : 'ok'}`} style={{ marginTop: 6 }}>{moveMsg.text}</div>}
            </details>
          )}
        </div>
      </div>
      {markup && (
        <PhotoMarkup
          photo={photo}
          onClose={() => setMarkup(false)}
          onSaved={async (row) => {
            await logEvent('photo_markup', { photo_id: row.id, from: photo.id });
            await onChanged();
            onAppend?.(row.id, photo.id);
            setMarkup(false);
            setId(row.id);
          }}
        />
      )}
    </>,
    document.body,
  );
}
