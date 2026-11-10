'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSupabase } from '@/lib/supabaseClient';
import { PHOTO_BUCKET } from '@/lib/jobDocs';
import { uploadJobPhoto } from '@/lib/photoUpload';
import PhotoMarkupEditor from '@/components/job/PhotoMarkupEditor';

// Mark up a saved photo with the same editor as the camera (rectangle, circle, arrow, text). Saving
// adds a NEW photo (the original is never changed) that remembers which photo it came from.
export default function PhotoMarkup({ photo, onClose, onSaved }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    let made = null;
    (async () => {
      try {
        const { data, error } = await getSupabase().storage.from(PHOTO_BUCKET).download(photo.storage_path);
        if (error || !data) throw new Error(error?.message || 'Could not open the photo.');
        made = URL.createObjectURL(data);
        if (alive) setUrl(made); else URL.revokeObjectURL(made);
      } catch (e) {
        if (alive) setErr(e.message);
      }
    })();
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [photo.storage_path]);

  async function save(blob) {
    if (!blob) return;
    setErr('');
    try {
      const row = await uploadJobPhoto({
        sb: getSupabase(), jobId: photo.job_id, file: blob, kind: photo.kind, takenAt: photo.taken_at,
        caption: photo.caption ? `${photo.caption} (marked up)` : 'Marked up',
        sketchId: photo.sketch_id, roomKey: photo.room_key, derivedFrom: photo.id,
      });
      await onSaved(row);
    } catch (e) {
      setErr(e.message);
    }
  }

  return createPortal(
    url ? (
      <>
        <PhotoMarkupEditor imageUrl={url} onSave={save} onClose={onClose} saveLabel="Save as new photo" onTop requireMarks />
        {err && <div className="msg err" style={{ position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 2500 }}>{err}</div>}
      </>
    ) : (
      <div className="markup-overlay markup-top" role="dialog" aria-label="Mark up photo">
        <div className="markup-canvas-wrap">
          <div className="empty-state" style={{ color: '#fff', textAlign: 'center' }}>
            {err || 'Opening photo...'}
            {err && <div style={{ marginTop: 12 }}><button type="button" className="btn" onClick={onClose}>Close</button></div>}
          </div>
        </div>
      </div>
    ),
    document.body,
  );
}
