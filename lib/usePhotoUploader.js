'use client';
import { useCallback, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { uploadJobPhoto } from '@/lib/photoUpload';

const looksLikeImage = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || '');

// One shared uploader for the job page, so the Photos tab, a sketch room and an update all report
// progress the same way. upload(files, { kind, sketchId, roomKey }) resolves to the rows added.
// A picture that fails does not stop the others; its error is listed so it can be retried.
export function usePhotoUploader({ jobId, onUploaded, logEvent }) {
  const [state, setState] = useState({ total: 0, done: 0, errors: [] });
  const cb = useRef({});
  cb.current = { onUploaded, logEvent };

  const upload = useCallback(async (fileList, opts = {}) => {
    const files = [...(fileList || [])].filter(looksLikeImage);
    const skipped = [...(fileList || [])].length - files.length;
    if (skipped > 0) setState((s) => ({ ...s, errors: [...s.errors, `${skipped} file${skipped === 1 ? ' was' : 's were'} not pictures and ${skipped === 1 ? 'was' : 'were'} skipped.`] }));
    if (!files.length) return [];
    setState((s) => ({ ...s, total: s.total + files.length }));
    const sb = getSupabase();
    const rows = [];
    for (const file of files) {
      try {
        rows.push(await uploadJobPhoto({ sb, jobId, file, kind: opts.kind || 'during', sketchId: opts.sketchId || null, roomKey: opts.roomKey || null }));
      } catch (e) {
        setState((s) => ({ ...s, errors: [...s.errors, `${file.name || 'Picture'}: ${e.message}`] }));
      }
      setState((s) => ({ ...s, done: s.done + 1 }));
    }
    setState((s) => (s.done >= s.total ? { ...s, total: 0, done: 0 } : s));
    if (rows.length) {
      await cb.current.logEvent?.('photos_added', { count: rows.length, kind: opts.kind || 'during' });
      await cb.current.onUploaded?.(rows);
    }
    return rows;
  }, [jobId]);

  const clearErrors = useCallback(() => setState((s) => ({ ...s, errors: [] })), []);
  return { upload, busy: state.total > 0, done: state.done, total: state.total, errors: state.errors, clearErrors };
}
