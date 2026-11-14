'use client';
// The one offline queue for this browser, plus the things that keep it moving: it runs when the page opens, when the
// connection comes back, when the app returns to the foreground, and on a timer while anything is waiting.
// iPhone and iPad cannot upload in the background after the app is closed, so the app must be opened once there is
// signal; the pictures wait safely on the phone until then.
import { useEffect, useState } from 'react';
import { getSupabase } from './supabaseClient';
import { openDb, cacheGet, cacheSet, cacheKeys, cacheDelete, metaGet, metaSet } from './offlineDb';
import { createPhotoQueue } from './offlineQueue';
import { createOpsQueue } from './offlineOps';
import { createOpsRemote } from './offlineOpsRemote';
import { createRemote, lastUser } from './offlineRemote';

let dbPromise = null;
let queuePromise = null;
let opsPromise = null;
const opsFinishedListeners = new Set();
let queue = null;
const listeners = new Set();
const finishedListeners = new Set();
let channel = null;
let started = false;
let timer = null;

const notify = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });

function getDb() {
  if (!dbPromise) dbPromise = openDb().catch(() => null); // null: no storage here (private browsing, very old browser)
  return dbPromise;
}

// Small copies of server data kept for opening things with no signal (a job, a sketch). Never throws.
export async function cacheRead(key) {
  try { const db = await getDb(); const r = db ? await cacheGet(db, key) : null; return r ? r.value : null; } catch { return null; }
}
export async function cacheWrite(key, value) {
  try { const db = await getDb(); if (db) await cacheSet(db, key, value); } catch { /* storage full: carry on without a copy */ }
}
// On sign-out: forget the copies of server data. Pictures still waiting to upload are NOT touched.
export async function cacheClearAll() {
  try { const db = await getDb(); if (!db) return; for (const k of await cacheKeys(db)) await cacheDelete(db, k); } catch { /* nothing to do */ }
}
export async function metaRead(key) { try { const db = await getDb(); return db ? await metaGet(db, key) : null; } catch { return null; } }
export async function metaWrite(key, value) { try { const db = await getDb(); if (db) await metaSet(db, key, value); } catch { /* ignore */ } }

export function getQueue() {
  if (queuePromise) return queuePromise;
  queuePromise = (async () => {
    try {
      const db = await getDb();
      if (!db) return null;
      try { channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mj-offline') : null; } catch { channel = null; }
      queue = createPhotoQueue({
        db,
        remote: createRemote(getSupabase()),
        onChange: () => { notify(); try { channel?.postMessage('changed'); } catch { /* closed */ } },
        onFinished: (list) => finishedListeners.forEach((fn) => { try { fn(list); } catch { /* ignore */ } }),
      });
      if (channel) channel.onmessage = () => notify();
      return queue;
    } catch {
      return null; // no storage available (private browsing, very old browser): callers fall back to a direct upload
    }
  })();
  return queuePromise;
}

export function getOps() {
  if (opsPromise) return opsPromise;
  opsPromise = (async () => {
    try {
      const db = await getDb();
      if (!db) return null;
      return createOpsQueue({
        db,
        remote: createOpsRemote(getSupabase(), () => lastUser()?.id || null),
        onChange: () => { notify(); try { channel?.postMessage('changed'); } catch { /* closed */ } },
        onFinished: (list) => opsFinishedListeners.forEach((fn) => { try { fn(list); } catch { /* ignore */ } }),
      });
    } catch { return null; }
  })();
  return opsPromise;
}
export const onOpsFinished = (fn) => { opsFinishedListeners.add(fn); return () => opsFinishedListeners.delete(fn); };

export const onQueueChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const onPhotosFinished = (fn) => { finishedListeners.add(fn); return () => finishedListeners.delete(fn); };

export async function kick({ force = false } = {}) {
  const [q, o] = await Promise.all([getQueue(), getOps()]);
  if (!q && !o) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !force) return null;
  // taps and notes first (they are quick and keep their order), then the pictures
  let ops = null;
  try { ops = o ? await o.run({ force }) : null; } catch { /* keep going */ }
  let photos = null;
  try { photos = q ? await q.run({ force }) : null; } catch { /* keep going */ }
  return { photos, ops };
}

// Ask the browser not to clear our storage when the phone is low on space.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist?.();
  } catch { /* not supported */ }
}

export async function storageRoom() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && e.quota ? { quota: e.quota, usage: e.usage || 0 } : null;
  } catch { return null; }
}

// Called once when the signed-in app shell mounts.
export function startRunner() {
  if (started || typeof window === 'undefined') return () => {};
  started = true;
  const go = () => kick();
  const goNow = () => kick({ force: true });
  const vis = () => { if (document.visibilityState === 'visible') goNow(); };
  window.addEventListener('online', goNow);
  window.addEventListener('focus', go);
  document.addEventListener('visibilitychange', vis);
  timer = setInterval(go, 15_000);
  go();
  return () => {
    started = false;
    window.removeEventListener('online', goNow);
    window.removeEventListener('focus', go);
    document.removeEventListener('visibilitychange', vis);
    clearInterval(timer);
  };
}

// { pending, blocked, others, signinNeeded, bytes, online } for the banner and badges.
export function useQueueStats() {
  const [s, setS] = useState({ pending: 0, blocked: 0, others: 0, signinNeeded: false, bytes: 0, ops: 0, opsBlocked: 0, online: true });
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const q = await getQueue();
      if (!q || !alive) return;
      const [st, o] = await Promise.all([q.stats(), getOps().then((x) => (x ? x.stats() : null))]);
      if (alive) setS({ ...st, ops: o ? o.pending : 0, opsBlocked: o ? o.blocked : 0, online: navigator.onLine !== false });
    };
    refresh();
    const off = onQueueChange(refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => { alive = false; off(); window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh); };
  }, []);
  return s;
}

// Pictures taken on this phone that have not reached the server yet, for one job (or all when jobId is null).
// Each: { id, jobId, kind, caption, roomKey, takenAt, state, lastError, url } where url is a local preview.
export function useWaitingPhotos(jobId = null) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let alive = true;
    let urls = [];
    const refresh = async () => {
      const q = await getQueue();
      if (!q || !alive) return;
      const list = (await q.list()).filter((r) => r.state !== 'done' && (!jobId || r.jobId === jobId));
      const thumbs = await Promise.all(list.map((r) => q.thumbOf(r.id)));
      const next = list.map((r, i) => {
        const url = thumbs[i] ? URL.createObjectURL(thumbs[i]) : null;
        if (url) urls.push(url);
        return { id: r.id, jobId: r.jobId, kind: r.kind, caption: r.caption, roomKey: r.roomKey, takenAt: r.takenAt, state: r.state, lastError: r.lastError, attempts: r.attempts, url };
      });
      const old = urls.filter((u) => !next.some((n) => n.url === u));
      old.forEach((u) => URL.revokeObjectURL(u));
      urls = urls.filter((u) => next.some((n) => n.url === u));
      if (alive) setItems(next);
    };
    refresh();
    const off = onQueueChange(refresh);
    return () => { alive = false; off(); urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [jobId]);
  return items;
}

export { lastUser };
