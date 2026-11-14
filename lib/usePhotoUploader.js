'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { uploadJobPhoto, prepareImage } from '@/lib/photoUpload';
import { takenAtFor } from '@/lib/jobDocs';
import { getQueue, kick, onPhotosFinished, requestPersistence } from '@/lib/offlineClient';
import { lastUser } from '@/lib/offlineRemote';

const looksLikeImage = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || '');

function saveError(e) {
  if (e?.name === 'QuotaExceededError' || /full|quota/i.test(e?.message || '')) return 'This phone is out of storage, so the picture was NOT saved. Free up some space and take it again.';
  return e?.message || 'The picture could not be saved on this phone.';
}

// One shared uploader for the job page, so the Photos tab, a sketch room and an update all work the same way.
// upload(files, { kind, sketchId, roomKey, onItem, quiet }) resolves to the pictures added.
//
// A picture is first saved on this phone (it survives a lost signal, a closed app and a dead battery), then sent in the
// background, and removed from the phone only after the server has it. So onItem reports:
//   'uploading' (getting it ready) -> 'queued' (saved on the phone; it will upload, now or when there is signal) | 'error' (NOT saved)
// A picture that fails to save does not stop the others; its error is listed so it can be retried.
// When the browser has no storage at all, it falls back to uploading directly like before ('done').
export function usePhotoUploader({ jobId, onUploaded, logEvent }) {
  const [state, setState] = useState({ total: 0, done: 0, errors: [] });
  const cb = useRef({});
  cb.current = { onUploaded, logEvent };

  // when pictures for this job reach the server (possibly long after they were taken), refresh the page's list
  useEffect(() => onPhotosFinished((list) => {
    if (list.some((p) => p.jobId === jobId)) cb.current.onUploaded?.([]);
  }), [jobId]);

  const upload = useCallback(async (fileList, opts = {}) => {
    const files = [...(fileList || [])].filter(looksLikeImage);
    const skipped = [...(fileList || [])].length - files.length;
    const notImage = [...(fileList || [])].filter((f) => !looksLikeImage(f));
    notImage.forEach((f) => opts.onItem?.(f, 'error', 'Not a picture.'));
    if (skipped > 0 && !opts.quiet) setState((s) => ({ ...s, errors: [...s.errors, `${skipped} file${skipped === 1 ? ' was' : 's were'} not pictures and ${skipped === 1 ? 'was' : 'were'} skipped.`] }));
    if (!files.length) return [];
    setState((s) => ({ ...s, total: s.total + files.length }));
    const sb = getSupabase();
    const q = await getQueue();
    const user = lastUser();
    const rows = [];
    for (const file of files) {
      opts.onItem?.(file, 'uploading');
      try {
        if (q && user?.id) {
          const prepared = await prepareImage(file);
          const row = await q.enqueue({
            jobId, userId: user.id, kind: opts.kind || 'during', sketchId: opts.sketchId || null, roomKey: opts.roomKey || null,
            takenAt: takenAtFor(file.lastModified), fullBlob: prepared.fullBlob, thumbBlob: prepared.thumbBlob, width: prepared.width, height: prepared.height,
          });
          rows.push(row);
          opts.onItem?.(file, 'queued', row);
        } else {
          const row = await uploadJobPhoto({ sb, jobId, file, kind: opts.kind || 'during', sketchId: opts.sketchId || null, roomKey: opts.roomKey || null });
          rows.push(row);
          opts.onItem?.(file, 'done', row);
        }
      } catch (e) {
        const msg = q && user?.id ? saveError(e) : e.message;
        opts.onItem?.(file, 'error', msg);
        if (!opts.quiet) setState((s) => ({ ...s, errors: [...s.errors, `${file.name || 'Picture'}: ${msg}`] }));
      }
      setState((s) => ({ ...s, done: s.done + 1 }));
    }
    setState((s) => (s.done >= s.total ? { ...s, total: 0, done: 0 } : s));
    if (rows.length) {
      if (rows.some((r) => r.pending)) {
        requestPersistence();
        kick({ force: true }); // start sending right away if there is a connection (not awaited: it never holds up the next picture)
      } else {
        await cb.current.logEvent?.('photos_added', { count: rows.length, kind: opts.kind || 'during' });
        await cb.current.onUploaded?.(rows);
      }
    }
    return rows;
  }, [jobId]);

  const clearErrors = useCallback(() => setState((s) => ({ ...s, errors: [] })), []);
  return { upload, busy: state.total > 0, done: state.done, total: state.total, errors: state.errors, clearErrors };
}
