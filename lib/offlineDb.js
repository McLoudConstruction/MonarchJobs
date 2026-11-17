// Durable storage on the phone for work done without a signal: photos waiting to upload, taps and notes waiting to
// be applied, and a copy of recently opened jobs so a page can open offline. Uses IndexedDB (survives closing the
// app, a dead battery and a restart; localStorage cannot hold pictures).
//
// Pictures are stored as bytes (ArrayBuffer plus type), not as Blob objects: some iPhone versions lose or corrupt
// Blobs kept in IndexedDB, bytes are safe everywhere.
//
// Every function takes the database from open(); tests pass a fake IndexedDB.

const DB_NAME = 'mj-offline';
const VERSION = 1;

export function openDb(factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('NO_INDEXEDDB')); return; }
    let req;
    try { req = factory.open(DB_NAME, VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('state', 'state');
        s.createIndex('jobId', 'jobId');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'key' }); // picture bytes, kept apart so listing the queue stays light
      if (!db.objectStoreNames.contains('ops')) {
        const s = db.createObjectStore('ops', { keyPath: 'opId' });
        s.createIndex('state', 'state');
        s.createIndex('jobId', 'jobId');
      }
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open storage.'));
    req.onblocked = () => reject(new Error('Storage is blocked by another tab.'));
  });
}

const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

// Runs fn(store) inside one transaction and resolves when the transaction has COMMITTED (not just when the request
// succeeded), so a "saved" result really means the bytes are on disk.
function tx(db, storeName, mode, fn) {
  const names = Array.isArray(storeName) ? storeName : [storeName];
  return new Promise((resolve, reject) => {
    let result;
    let t;
    try { t = db.transaction(names, mode); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error('Storage error.'));
    t.onabort = () => reject(t.error || new Error('Storage was full or unavailable.'));
    const arg = Array.isArray(storeName) ? (n) => t.objectStore(n) : t.objectStore(names[0]);
    Promise.resolve(fn(arg)).then((r) => { result = r; }).catch((e) => { try { t.abort(); } catch { /* done */ } reject(e); });
  });
}

// ------------------------------------------------------------------ bytes
export async function toBytes(blob) {
  if (!blob) return null;
  if (blob.bytes instanceof ArrayBuffer) return blob;
  const buf = await blob.arrayBuffer();
  return { bytes: buf, type: blob.type || 'application/octet-stream' };
}
export const fromBytes = (b) => (b ? new Blob([b.bytes], { type: b.type }) : null);

// ------------------------------------------------------------------ photos
// record (small): { id, jobId, userId, kind, caption, sketchId, roomKey, derivedFrom, takenAt, createdAt, width, height, bytes,
//   gpsLat, gpsLng, gpsAccuracy, contentHash, tags, pairOf, hasOriginal, originalUploaded,
//   state: 'pending'|'blocked'|'cancelled'|'done', fullUploaded, thumbUploaded, rowInserted, eventLogged, attempts, nextTryAt, lastError, doneAt }
// The picture bytes are in the 'blobs' store as `${id}:full`, `${id}:thumb` and, when full-size originals are kept, `${id}:original`.
export async function putPhoto(db, rec, full, thumb, original = null) {
  await tx(db, ['photos', 'blobs'], 'readwrite', async (st) => {
    if (full) await wrap(st('blobs').put({ key: `${rec.id}:full`, ...full }));
    if (thumb) await wrap(st('blobs').put({ key: `${rec.id}:thumb`, ...thumb }));
    if (original) await wrap(st('blobs').put({ key: `${rec.id}:original`, ...original }));
    await wrap(st('photos').put(rec));
  });
  return rec;
}
export const getPhoto = (db, id) => tx(db, 'photos', 'readonly', (s) => wrap(s.get(id)));
export const allPhotos = (db) => tx(db, 'photos', 'readonly', (s) => wrap(s.getAll()));
export const getBlob = (db, id, which) => tx(db, 'blobs', 'readonly', (s) => wrap(s.get(`${id}:${which}`))).then((r) => (r ? { bytes: r.bytes, type: r.type } : null));
export const deletePhoto = (db, id) => tx(db, ['photos', 'blobs'], 'readwrite', async (st) => {
  await wrap(st('photos').delete(id));
  await wrap(st('blobs').delete(`${id}:full`));
  await wrap(st('blobs').delete(`${id}:thumb`));
  await wrap(st('blobs').delete(`${id}:original`));
});

// Read, change, write in one transaction so two tabs cannot overwrite each other's progress.
// With dropBlobs, the picture bytes are removed in the SAME transaction (used when the server confirmed the picture).
export async function updatePhoto(db, id, fn, { dropBlobs = false } = {}) {
  return tx(db, ['photos', 'blobs'], 'readwrite', async (st) => {
    const cur = await wrap(st('photos').get(id));
    if (!cur) return null;
    const next = fn({ ...cur });
    if (next) await wrap(st('photos').put(next));
    if (dropBlobs) {
      await wrap(st('blobs').delete(`${id}:full`));
      await wrap(st('blobs').delete(`${id}:thumb`));
      await wrap(st('blobs').delete(`${id}:original`));
    }
    return next || cur;
  });
}

// ------------------------------------------------------------------ operations (taps, notes)
export const putOp = (db, rec) => tx(db, 'ops', 'readwrite', (s) => wrap(s.put(rec))).then(() => rec);
export const getOp = (db, opId) => tx(db, 'ops', 'readonly', (s) => wrap(s.get(opId)));
export const allOps = (db) => tx(db, 'ops', 'readonly', (s) => wrap(s.getAll()));
export const deleteOp = (db, opId) => tx(db, 'ops', 'readwrite', (s) => wrap(s.delete(opId)));
export async function updateOp(db, opId, fn) {
  return tx(db, 'ops', 'readwrite', async (s) => {
    const cur = await wrap(s.get(opId));
    if (!cur) return null;
    const next = fn({ ...cur });
    if (next) await wrap(s.put(next));
    return next || cur;
  });
}

// ------------------------------------------------------------------ cached pages and small settings
export const cacheSet = (db, key, value) => tx(db, 'cache', 'readwrite', (s) => wrap(s.put({ key, value, at: Date.now() })));
export const cacheGet = (db, key) => tx(db, 'cache', 'readonly', (s) => wrap(s.get(key))).then((r) => r || null);
export const cacheDelete = (db, key) => tx(db, 'cache', 'readwrite', (s) => wrap(s.delete(key)));
export const cacheKeys = (db) => tx(db, 'cache', 'readonly', (s) => wrap(s.getAllKeys()));
export const metaSet = (db, key, value) => tx(db, 'meta', 'readwrite', (s) => wrap(s.put({ key, value })));
export const metaGet = (db, key) => tx(db, 'meta', 'readonly', (s) => wrap(s.get(key))).then((r) => (r ? r.value : null));
