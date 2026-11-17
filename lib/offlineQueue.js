// The offline photo queue. A picture is saved on the phone FIRST, then sent when there is a connection, and only
// removed from the phone once the server has confirmed it. Nothing is ever dropped because of an error.
//
// Rules this file keeps:
//  1. enqueue resolves only after the bytes are committed to storage. If storage fails, it throws, and the caller
//     must tell the person the photo was NOT saved.
//  2. Every step is idempotent and its progress is saved: the picture's id is made on the phone, so a retry after a
//     crash or a lost reply can never create a second picture.
//  3. A network problem pauses the whole pass and retries with backoff; it is never counted against the picture.
//  4. A "no" from the server (job closed, no permission) keeps the picture, marks it Needs attention, and carries on
//     with the others. It can be retried or saved to the phone's files by hand.
//  5. Only the person who took a picture uploads it. Another sign-in on the same phone leaves it alone.
//  6. Only one tab or window runs the queue at a time.
//  7. The full-size original (when the owner keeps originals) is a bonus: if the server refuses it, the picture still
//     goes up without it. The camera's Undo can cancel a picture that has not been confirmed yet.
import {
  openDb, putPhoto, updatePhoto, allPhotos, deletePhoto, toBytes, fromBytes, getPhoto, getBlob,
} from './offlineDb.js';
import { photoPaths } from './jobDocs.js';

export const BUCKET = 'job-photos';
export const KEEP_DONE_MS = 3 * 24 * 3600 * 1000;
const BACKOFF = [2000, 5000, 15000, 30000, 60000, 120000, 300000];
export const backoffMs = (attempts) => BACKOFF[Math.min(Math.max(attempts - 1, 0), BACKOFF.length - 1)];

// Turns whatever a Supabase call returned into one of: network (try later, nothing wrong with the picture),
// auth (sign in again), blocked (the server said no), retry (server hiccup), duplicate (already there).
export function classifyError(err, status = 0) {
  if (!err) return null;
  const msg = String(err.message || err);
  const code = String(err.code || '');
  const st = Number(status || err.status || err.statusCode || 0);
  if (code === '23505' || /already exists|duplicate key|resource already exists/i.test(msg) || st === 409) return 'duplicate';
  if (/jwt expired|invalid jwt|not authenticated|invalid claim|PGRST30[1-3]/i.test(msg + code) || st === 401) return 'auth';
  if (/failed to fetch|networkerror|network request failed|load failed|timeout|timed out|econn|enotfound|fetch failed|offline|aborted|err_internet/i.test(msg) || st === 0 && !code && !st && /fetch|network/i.test(msg)) return 'network';
  if (st === 429 || st >= 500 || /^5\d\d$/.test(code)) return 'retry';
  if (code === '42501' || /row-level security|permission denied|not allowed|violates row/i.test(msg) || st === 403) return 'blocked';
  if (code === '23503' || st === 413 || st === 400 || st === 404) return 'blocked';
  return 'retry';
}

// An in-process lock, used when the browser has no Web Locks (tests, old browsers).
function memoryLocks() {
  let held = false;
  return { run: async (fn) => { if (held) return undefined; held = true; try { return await fn(); } finally { held = false; } } };
}
function webLocks() {
  return { run: (fn) => navigator.locks.request('mj-offline-runner', { ifAvailable: true }, (lock) => (lock ? fn() : undefined)) };
}

// remote: { uploadFile(path, blob, contentType) -> {error?, status?}, insertPhoto(row) -> {error?, status?, data?},
//           logEvent(jobId, kind, details) -> {error?}, userId() -> string|null, archivePhoto?(id) -> {error?} }
export function createPhotoQueue({ db, remote, now = () => Date.now(), onChange = () => {}, onFinished = () => {}, locks = null }) {
  const lock = locks || (typeof navigator !== 'undefined' && navigator.locks ? webLocks() : memoryLocks());
  let signinNeeded = false;
  let pausedUntil = 0; // after a network or server failure, wait before trying anything again (Retry now skips this)

  const changed = () => { try { onChange(); } catch { /* never let a listener break the queue */ } };

  // gps: { lat, lng, accuracy } taken at the moment of the shot (or null). contentHash: sha-256 of the picture as it was
  // picked. originalBlob: the full-size original, only when the owner keeps originals.
  async function enqueue({ jobId, userId, kind = 'during', caption = '', sketchId = null, roomKey = null, derivedFrom = null, takenAt, fullBlob, thumbBlob, width, height, photoId, gps = null, contentHash = null, tags = [], pairOf = null, originalBlob = null }) {
    if (!jobId || !userId) throw new Error('Cannot save this photo: not signed in.');
    const id = photoId || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : null);
    if (!id) throw new Error('This browser cannot save pictures.');
    const [full, thumb, original] = await Promise.all([toBytes(fullBlob), toBytes(thumbBlob), originalBlob ? toBytes(originalBlob) : null]);
    const rec = {
      id, jobId, userId, kind, caption, sketchId, roomKey, derivedFrom,
      takenAt: takenAt || new Date(now()).toISOString(), createdAt: now(), width, height, bytes: full.bytes.byteLength,
      gpsLat: gps ? gps.lat : null, gpsLng: gps ? gps.lng : null, gpsAccuracy: gps ? gps.accuracy ?? null : null,
      contentHash: contentHash || null, tags: Array.isArray(tags) ? tags : [], pairOf: pairOf || null,
      hasOriginal: !!original, originalBytes: original ? original.bytes.byteLength : 0, originalUploaded: false,
      state: 'pending', fullUploaded: false, thumbUploaded: false, rowInserted: false, eventLogged: false,
      attempts: 0, nextTryAt: 0, lastError: '', doneAt: null,
    };
    await putPhoto(db, rec, full, thumb, original); // resolves after the transaction committed: the photo is safe on the phone
    changed();
    return {
      id, jobId, kind, width, height, bytes: rec.bytes, taken_at: rec.takenAt, pending: true,
      sketch_id: sketchId, room_key: roomKey, tags: rec.tags, content_hash: rec.contentHash,
    };
  }

  // Sends one picture, resuming at the first step that has not finished. Returns 'done' | 'network' | 'auth' | 'blocked' | 'retry'.
  async function process(rec) {
    const paths = photoPaths(rec.jobId, rec.id);
    // the person may have pressed Undo in the camera since this pass started
    const cancelled = async () => {
      const cur = await getPhoto(db, rec.id);
      if (cur && cur.state !== 'cancelled') return false;
      if (cur) await deletePhoto(db, rec.id);
      return true;
    };
    const fail = async (kind, error) => {
      const msg = String(error?.message || error || 'Unknown error');
      if (kind === 'blocked') {
        await updatePhoto(db, rec.id, (r) => ({ ...r, state: 'blocked', lastError: msg }));
      } else {
        await updatePhoto(db, rec.id, (r) => ({ ...r, attempts: r.attempts + (kind === 'auth' ? 0 : 1), nextTryAt: now() + (kind === 'auth' ? 0 : backoffMs(r.attempts + 1)), lastError: kind === 'network' ? 'Waiting for a connection' : msg }));
      }
      return kind;
    };

    if (await cancelled()) return 'cancelled';
    if (!rec.fullUploaded) {
      const full = await getBlob(db, rec.id, 'full');
      if (!full) return fail('blocked', new Error('The picture file is missing from this phone.'));
      const r = await remote.uploadFile(paths.full, fromBytes(full), 'image/jpeg');
      const k = classifyError(r.error, r.status);
      if (k && k !== 'duplicate') return fail(k, r.error);
      rec = await updatePhoto(db, rec.id, (x) => ({ ...x, fullUploaded: true }));
      if (!rec) return 'cancelled'; // undone while this step was running
    }
    if (!rec.thumbUploaded) {
      const thumb = await getBlob(db, rec.id, 'thumb');
      if (!thumb) return fail('blocked', new Error('The picture file is missing from this phone.'));
      const r = await remote.uploadFile(paths.thumb, fromBytes(thumb), 'image/jpeg');
      const k = classifyError(r.error, r.status);
      if (k && k !== 'duplicate') return fail(k, r.error);
      rec = await updatePhoto(db, rec.id, (x) => ({ ...x, thumbUploaded: true }));
      if (!rec) return 'cancelled'; // undone while this step was running
    }
    if (rec.hasOriginal && !rec.originalUploaded) {
      const orig = await getBlob(db, rec.id, 'original');
      let patch = null;
      if (!orig) {
        patch = { hasOriginal: false };
      } else {
        const r = await remote.uploadFile(paths.original, fromBytes(orig), orig.type || 'image/jpeg');
        const k = classifyError(r.error, r.status);
        if (k === 'blocked') patch = { hasOriginal: false }; // too big or not allowed: carry on without it
        else if (k && k !== 'duplicate') return fail(k, r.error);
        else patch = { originalUploaded: true };
      }
      rec = await updatePhoto(db, rec.id, (x) => ({ ...x, ...patch }));
      if (!rec) return 'cancelled'; // undone while this step was running
    }
    if (!rec.rowInserted) {
      if (await cancelled()) return 'cancelled';
      const row = {
        id: rec.id, job_id: rec.jobId, kind: rec.kind, caption: rec.caption, storage_path: paths.full, thumb_path: paths.thumb,
        width: rec.width, height: rec.height, bytes: rec.bytes, sketch_id: rec.sketchId, room_key: rec.roomKey,
        derived_from: rec.derivedFrom, taken_at: rec.takenAt,
        gps_lat: rec.gpsLat ?? null, gps_lng: rec.gpsLng ?? null, gps_accuracy_m: rec.gpsAccuracy ?? null,
        content_hash: rec.contentHash || null, tags: rec.tags || [], pair_of: rec.pairOf || null,
        original_path: rec.hasOriginal && rec.originalUploaded ? paths.original : null,
        original_bytes: rec.hasOriginal && rec.originalUploaded ? rec.originalBytes : null,
      };
      const r = await remote.insertPhoto(row);
      const k = classifyError(r.error, r.status);
      if (k && k !== 'duplicate') return fail(k, r.error);
      // The server confirmed the picture. Only now is the copy on the phone no longer needed.
      let wasCancelled = false;
      rec = await updatePhoto(db, rec.id, (x) => { wasCancelled = x.state === 'cancelled'; return { ...x, rowInserted: true, state: 'done', doneAt: now(), lastError: '' }; }, { dropBlobs: true });
      // Undo arrived while the picture was being confirmed: it is on the server now, so it is archived rather than lost
      if (wasCancelled) { try { await remote.archivePhoto?.(rec.id); } catch { /* it stays visible; the person can archive it */ } }
    }
    return 'done';
  }

  // One pass over everything waiting. Safe to call at any time and from several tabs.
  async function run({ force = false } = {}) {
    const uid = remote.userId();
    const out = { done: 0, remaining: 0, stopped: null };
    if (!force && now() < pausedUntil) { out.stopped = 'paused'; out.remaining = (await stats()).pending; return out; }
    await lock.run(async () => {
      const all = await allPhotos(db);
      const todo = all
        .filter((r) => r.state === 'pending' && (!uid || r.userId === uid) && (force || r.nextTryAt <= now()))
        .sort((a, b) => a.createdAt - b.createdAt);
      const finished = [];
      for (const rec of todo) {
        let res;
        try { res = await process(rec); } catch (e) {
          // an unexpected error: keep the picture and try again later
          await updatePhoto(db, rec.id, (r) => ({ ...r, attempts: r.attempts + 1, nextTryAt: now() + backoffMs(r.attempts + 1), lastError: String(e?.message || e) }));
          res = 'retry';
        }
        changed();
        if (res === 'done') { out.done += 1; finished.push(rec); signinNeeded = false; continue; }
        if (res === 'cancelled' || res === 'blocked') continue; // undone, or refused: the others may be fine
        out.stopped = res;                          // network, auth or server trouble: stop and try later
        if (res === 'auth') signinNeeded = true;
        else pausedUntil = now() + backoffMs(rec.attempts + 1);
        break;
      }
      // one line in the job's history per job, for the pictures that arrived in this pass
      const byJob = new Map();
      for (const r of finished) { const l = byJob.get(r.jobId) || []; l.push(r); byJob.set(r.jobId, l); }
      if (finished.length) { pausedUntil = 0; try { onFinished(finished.map((r) => ({ id: r.id, jobId: r.jobId }))); } catch { /* a listener must not break the queue */ } }
      for (const [jobId, list] of byJob) {
        const kinds = [...new Set(list.map((r) => r.kind))];
        const res = await remote.logEvent(jobId, 'photos_added', { count: list.length, kind: kinds.length === 1 ? kinds[0] : undefined, offline: true });
        if (!res?.error) for (const r of list) await updatePhoto(db, r.id, (x) => ({ ...x, eventLogged: true }));
      }
      // tidy: forget finished records after a few days (never a waiting or refused one)
      for (const r of all) if (r.state === 'done' && r.doneAt && now() - r.doneAt > KEEP_DONE_MS) await deletePhoto(db, r.id);
      out.remaining = (await allPhotos(db)).filter((r) => r.state === 'pending' && (!uid || r.userId === uid)).length;
    });
    changed();
    return out;
  }

  async function list() {
    const uid = remote.userId();
    return (await allPhotos(db)).filter((r) => !uid || r.userId === uid).sort((a, b) => a.createdAt - b.createdAt);
  }

  async function stats() {
    const all = await allPhotos(db);
    const uid = remote.userId();
    const mine = all.filter((r) => !uid || r.userId === uid);
    const pending = mine.filter((r) => r.state === 'pending');
    const next = pending.reduce((m, r) => Math.min(m, r.nextTryAt || 0), Infinity);
    return {
      pending: pending.length,
      blocked: mine.filter((r) => r.state === 'blocked').length,
      others: all.filter((r) => r.state !== 'done' && uid && r.userId !== uid).length, // waiting for a different sign-in
      signinNeeded,
      nextTryAt: Number.isFinite(next) ? next : null,
      bytes: pending.reduce((n, r) => n + (r.bytes || 0), 0),
    };
  }

  // Person pressed Retry on a refused picture.
  async function retry(id) {
    await updatePhoto(db, id, (r) => (r.state === 'blocked' ? { ...r, state: 'pending', attempts: 0, nextTryAt: 0, lastError: '' } : r));
    changed();
  }
  // The camera's Undo. Works while the server has not confirmed the picture: it is dropped from the phone (the queue
  // notices and stops). Returns false when the picture is already on the server; the caller then archives it.
  async function cancel(id) {
    let ok = false;
    await updatePhoto(db, id, (r) => {
      if (r.rowInserted || r.state === 'done') return r;
      ok = true;
      return { ...r, state: 'cancelled' };
    });
    if (ok) {
      // nothing is running for it: remove it now. (If a pass is mid-way, that pass removes it at its next step.)
      const cur = await getPhoto(db, id);
      if (cur && cur.state === 'cancelled' && !cur.fullUploaded && !cur.thumbUploaded) await deletePhoto(db, id);
      changed();
    }
    return ok;
  }
  // Person removed a picture from the phone on purpose (only offered for refused pictures, after a warning).
  async function discard(id) {
    const r = await getPhoto(db, id);
    if (r && r.state === 'blocked') { await deletePhoto(db, id); changed(); }
  }
  async function bytesOf(id) {
    const [r, full, thumb] = await Promise.all([getPhoto(db, id), getBlob(db, id, 'full'), getBlob(db, id, 'thumb')]);
    return r && full ? { blob: fromBytes(full), thumb: fromBytes(thumb), rec: r } : null;
  }

  async function thumbOf(id) { const t = await getBlob(db, id, 'thumb'); return t ? fromBytes(t) : null; }

  return { enqueue, run, list, stats, retry, discard, cancel, bytesOf, thumbOf };
}

export { openDb };
