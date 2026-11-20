'use client';

import { useEffect, useRef, useState } from 'react';
import PopupModal from '@/components/PopupModal';
import { FilePick } from '@/components/job/PhotoUi';
import { getSupabase } from '@/lib/supabaseClient';
import { prepareImage } from '@/lib/photoUpload';
import { EVAL_BUCKET, evalPhotoPaths } from '@/lib/evals';

const isDuplicate = (err) => /already exists|duplicate/i.test(err?.message || '') || String(err?.statusCode) === '409';

// Shrinks the picture, uploads it and its small copy, and adds the eval_photos row.
async function uploadEvalPhoto(sb, evalId, file, kind) {
  const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : null;
  if (!id) throw new Error('This browser cannot upload pictures.');
  const paths = evalPhotoPaths(evalId, id);
  const { fullBlob, thumbBlob, width, height } = await prepareImage(file);
  const opts = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
  for (const [path, blob] of [[paths.full, fullBlob], [paths.thumb, thumbBlob]]) {
    const up = await sb.storage.from(EVAL_BUCKET).upload(path, blob, opts);
    if (up.error && !isDuplicate(up.error)) throw new Error(`Upload failed: ${up.error.message}`);
  }
  const { data, error } = await sb.from('eval_photos')
    .insert({ id, eval_id: evalId, kind, storage_path: paths.full, thumb_path: paths.thumb, width, height, bytes: fullBlob.size })
    .select('*').single();
  if (error) throw new Error(`Could not save the photo: ${error.message}`);
  return data;
}

// The pictures of one kind on an eval ('unit' = the unit itself, 'paper' = the filled-in paper copy): thumbnails, tap to enlarge,
// add by camera or library, remove. `photos` is every photo row of the eval; `onChange(nextRows)` gets the whole new list.
export default function EvalPhotos({ evalId, kind, label, hint, photos, canEdit, onChange }) {
  const mine = photos.filter((p) => p.kind === kind);
  const [urls, setUrls] = useState({});
  const [big, setBig] = useState(null); // { photo, url }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const latest = useRef(photos);
  latest.current = photos;

  // short-lived links for the small copies
  useEffect(() => {
    const need = mine.map((p) => p.thumb_path).filter((path) => !urls[path]);
    if (!need.length) return undefined;
    let live = true;
    getSupabase().storage.from(EVAL_BUCKET).createSignedUrls(need, 3600).then(({ data }) => {
      if (!live || !data) return;
      setUrls((u) => { const n = { ...u }; for (const d of data) if (d.signedUrl) n[d.path] = d.signedUrl; return n; });
    });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.map((p) => p.id).join(',')]);

  async function add(files) {
    setErr('');
    setBusy(true);
    const sb = getSupabase();
    try {
      for (const f of files) {
        const row = await uploadEvalPhoto(sb, evalId, f, kind);
        latest.current = [...latest.current, row];
        onChange(latest.current);
      }
    } catch (e) {
      setErr(e.message || 'Could not add the picture.');
    } finally {
      setBusy(false);
    }
  }

  async function enlarge(p) {
    const { data } = await getSupabase().storage.from(EVAL_BUCKET).createSignedUrl(p.storage_path, 3600);
    setBig({ photo: p, url: data?.signedUrl || urls[p.thumb_path] || '' });
  }

  async function remove(p) {
    if (!window.confirm('Remove this picture?')) return;
    setErr('');
    const sb = getSupabase();
    const { error } = await sb.from('eval_photos').delete().eq('id', p.id);
    if (error) { setErr(error.message); return; }
    await sb.storage.from(EVAL_BUCKET).remove([p.storage_path, p.thumb_path]); // the picture is already gone from the eval; a leftover file is harmless
    setBig(null);
    onChange(latest.current.filter((x) => x.id !== p.id));
  }

  return (
    <div className="field ep-box">
      <label>{label} ({mine.length})</label>
      {hint && <p className="hint" style={{ margin: '0 0 8px' }}>{hint}</p>}
      {mine.length > 0 && (
        <div className="ep-grid">
          {mine.map((p, i) => (
            <button key={p.id} type="button" className="ep-thumb" onClick={() => enlarge(p)} aria-label={`Open picture ${i + 1}`}>
              {urls[p.thumb_path] ? <img src={urls[p.thumb_path]} alt="" /> : <span className="muted">...</span>}
            </button>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="row" style={{ marginTop: 8 }}>
          <FilePick label="Take photo" capture multiple={false} onFiles={add} disabled={busy} />
          <FilePick label="Choose from library" onFiles={add} disabled={busy} />
        </div>
      )}
      {busy && <p className="hint" style={{ margin: '6px 0 0' }}>Saving picture...</p>}
      {err && <div className="banner flag" style={{ marginTop: 8 }}>{err}</div>}
      {mine.length === 0 && !canEdit && <p className="hint">None.</p>}
      <PopupModal open={!!big} onClose={() => setBig(null)} title={label} wide>
        {big && (
          <div style={{ padding: '0 16px 16px' }}>
            {big.url ? <img src={big.url} alt="" style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 8 }} /> : <p className="muted">Could not load the picture.</p>}
            {canEdit && <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}><button type="button" className="secondary danger" onClick={() => remove(big.photo)}>Remove picture</button></div>}
          </div>
        )}
      </PopupModal>
    </div>
  );
}
