'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSupabase } from '@/lib/supabaseClient';
import { PHOTO_BUCKET, PHOTO_KINDS, PHOTO_KIND_KEYS } from '@/lib/jobDocs';
import { normalizePlan } from '@/lib/sketch';
import { useSignedUrls } from '@/lib/useSignedUrls';
import { fmtDateTime } from '@/lib/format';
import PhotoMarkup from '@/components/job/PhotoMarkup';

// Full-screen photo viewer with the controls for one photo. list is the photos being browsed,
// startId the one to open on. Changes are saved straight away and the page is refreshed through
// onChanged. Photos are archived, never deleted.
export default function PhotoViewer({ list, startId, onClose, onChanged, onAppend, authorName, jobId, fileBase, logEvent }) {
  const [id, setId] = useState(startId);
  const [markup, setMarkup] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const idx = Math.max(0, list.findIndex((p) => p.id === id));
  const photo = list[idx];
  const urls = useSignedUrls([photo?.storage_path, photo?.thumb_path]);
  const full = photo ? urls[photo.storage_path] : null;
  const thumb = photo ? urls[photo.thumb_path] : null;

  // rooms from this job's sketches, for "which room is this photo of"
  useEffect(() => {
    let alive = true;
    getSupabase().from('job_sketches').select('id,name,plan').eq('job_id', jobId).order('sort_order').then(({ data }) => {
      if (!alive) return;
      setRooms((data || []).flatMap((s) => normalizePlan(s.plan).rooms.map((r) => ({
        value: `${s.id}|${r.id}`, label: `${data.length > 1 ? `${s.name}: ` : ''}${r.label || 'Unnamed room'}`,
      }))));
    });
    return () => { alive = false; };
  }, [jobId]);

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

  async function download() {
    setErr('');
    const { data, error } = await getSupabase().storage.from(PHOTO_BUCKET).download(photo.storage_path);
    if (error || !data) { setErr(error?.message || 'Could not download the photo.'); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBase}-${photo.kind}-${new Date(photo.taken_at).toISOString().slice(0, 10)}-${photo.id.slice(0, 6)}.jpg`;
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
          <div className="muted" style={{ fontSize: 12 }}>
            Taken {fmtDateTime(photo.taken_at)}{authorName(photo.created_by) ? ` · by ${authorName(photo.created_by)}` : ''}{photo.width ? ` · ${photo.width}×${photo.height}` : ''}{photo.derived_from ? ' · marked-up copy' : ''}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="secondary small" onClick={() => setMarkup(true)}>Mark up</button>
            <button type="button" className="secondary small" onClick={download}>Download</button>
            <button type="button" className={`${photo.archived_at ? 'secondary' : 'danger'} small`} disabled={busy} onClick={() => archive(!photo.archived_at)}>
              {photo.archived_at ? 'Restore' : 'Archive'}
            </button>
          </div>
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
