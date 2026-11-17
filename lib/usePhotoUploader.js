'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { uploadJobPhoto, prepareImage } from '@/lib/photoUpload';
import { takenAtFor } from '@/lib/jobDocs';
import { sha256Hex, knownHashes, shouldKeepOriginal, cleanTags } from '@/lib/photoMeta';
import { usePhotoSettings } from '@/lib/photoSettings';
import { getQueue, kick, onPhotosFinished, requestPersistence } from '@/lib/offlineClient';
import { lastUser } from '@/lib/offlineRemote';

const looksLikeImage = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || '');

function saveError(e) {
  if (e?.name === 'QuotaExceededError' || /full|quota/i.test(e?.message || '')) return 'This phone is out of storage, so the picture was NOT saved. Free up some space and take it again.';
  return e?.message || 'The picture could not be saved on this phone.';
}

// One shared uploader for the job page, so the Photos tab, a sketch room and an update all work the same way.
// upload(files, { kind, sketchId, roomKey, gps, tags, pairOf, skipDuplicates, onItem, quiet }) resolves to the pictures added.
//   gps: { lat, lng, accuracy } at the moment of the shot. skipDuplicates: leave out a picture whose bytes are already on
//   this job ('skipped'). undo(id): take back a picture just taken (removed from the phone, or archived if already sent).
//
// A picture is first saved on this phone (it survives a lost signal, a closed app and a dead battery), then sent in the
// background, and removed from the phone only after the server has it. So onItem reports:
//   'uploading' (getting it ready) -> 'queued' (saved on the phone; it will upload, now or when there is signal) | 'error' (NOT saved)
// A picture that fails to save does not stop the others; its error is listed so it can be retried.
// When the browser has no storage at all, it falls back to uploading directly like before ('done').
export function usePhotoUploader({ jobId, onUploaded, logEvent, photos = [] }) {
  const [state, setState] = useState({ total: 0, done: 0, errors: [] });
  const settings = usePhotoSettings();
  const cb = useRef({});
  cb.current = { onUploaded, logEvent, photos, keepOriginals: settings.keepOriginals };

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
    const tags = cleanTags(opts.tags);
    const gps = opts.gps || null;
    const seen = opts.skipDuplicates ? knownHashes(cb.current.photos, q ? await q.list().catch(() => []) : []) : null;
    let skippedCount = 0;
    for (const file of files) {
      opts.onItem?.(file, 'uploading');
      try {
        const contentHash = await sha256Hex(file);
        if (seen && contentHash && seen.has(contentHash)) {
          skippedCount += 1;
          opts.onItem?.(file, 'skipped', 'Already on this job.');
          setState((s) => ({ ...s, done: s.done + 1 }));
          continue;
        }
        if (seen && contentHash) seen.add(contentHash);
        if (q && user?.id) {
          const prepared = await prepareImage(file);
          const keep = shouldKeepOriginal({ keep: cb.current.keepOriginals, size: file.size, type: file.type, webSize: prepared.fullBlob.size });
          const row = await q.enqueue({
            jobId, userId: user.id, kind: opts.kind || 'during', sketchId: opts.sketchId || null, roomKey: opts.roomKey || null,
            takenAt: takenAtFor(file.lastModified), fullBlob: prepared.fullBlob, thumbBlob: prepared.thumbBlob, width: prepared.width, height: prepared.height,
            gps, contentHash, tags, pairOf: opts.pairOf || null, originalBlob: keep ? file : null,
          });
          rows.push(row);
          opts.onItem?.(file, 'queued', row);
        } else {
          const row = await uploadJobPhoto({
            sb, jobId, file, kind: opts.kind || 'during', sketchId: opts.sketchId || null, roomKey: opts.roomKey || null,
            gps, contentHash, tags, pairOf: opts.pairOf || null,
            keepOriginal: shouldKeepOriginal({ keep: cb.current.keepOriginals, size: file.size, type: file.type, webSize: 0 }),
          });
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
    if (skippedCount && !opts.quiet) setState((s) => ({ ...s, errors: [...s.errors, `${skippedCount} picture${skippedCount === 1 ? ' was' : 's were'} already on this job and ${skippedCount === 1 ? 'was' : 'were'} skipped.`] }));
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

  // Take back a picture just taken. 'removed': it never left the phone. 'archived': it had already reached the job, so it is
  // archived (photos are never deleted). 'failed': could not be done.
  const undo = useCallback(async (id) => {
    try {
      const q = await getQueue();
      if (q && await q.cancel(id)) return 'removed'; // it never reached the job, so there is nothing to record
      const { error } = await getSupabase().from('job_photos').update({ archived_at: new Date().toISOString() }).eq('id', id);
      if (error) return 'failed';
      await cb.current.logEvent?.('photo_undone', { photo_id: id });
      await cb.current.onUploaded?.([]);
      return 'archived';
    } catch { return 'failed'; }
  }, []);

  const clearErrors = useCallback(() => setState((s) => ({ ...s, errors: [] })), []);
  return { upload, undo, busy: state.total > 0, done: state.done, total: state.total, errors: state.errors, clearErrors };
}
