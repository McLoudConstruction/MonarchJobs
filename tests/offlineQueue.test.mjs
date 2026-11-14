import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, allPhotos, getBlob } from '../lib/offlineDb.js';
import { createPhotoQueue, classifyError, backoffMs } from '../lib/offlineQueue.js';

let n = 0;
async function setup(opts = {}) {
  globalThis.indexedDB = new (await import('fake-indexeddb')).IDBFactory(); // a fresh, empty phone
  const db = await openDb();
  const clock = { t: 1_000_000 };
  const server = { files: new Map(), rows: new Map(), events: [], calls: [], down: false, failNext: [], rowError: null };
  const remote = {
    userId: () => opts.userId ?? 'u1',
    async uploadFile(path, blob) {
      server.calls.push(`file:${path.split('/').pop()}`);
      if (server.down) return { error: new Error('TypeError: Failed to fetch') };
      const f = server.failNext.length ? server.failNext.shift() : null;
      if (f) return f;
      if (server.files.has(path)) return { error: { message: 'The resource already exists', statusCode: '409' } };
      server.files.set(path, blob.size);
      return {};
    },
    async insertPhoto(row) {
      server.calls.push('row');
      if (server.down) return { error: new Error('TypeError: Failed to fetch') };
      const re = typeof server.rowError === 'function' ? server.rowError(row) : server.rowError;
      if (re) return re;
      if (server.rows.has(row.id)) return { error: { code: '23505', message: 'duplicate key value' } };
      server.rows.set(row.id, row);
      return { data: row };
    },
    async logEvent(jobId, kind, details) { server.events.push({ jobId, kind, details }); return {}; },
  };
  const q = createPhotoQueue({ db, remote, now: () => clock.t });
  return { db, q, server, clock, remote };
}
const shot = (over = {}) => ({
  jobId: 'job1', userId: 'u1', kind: 'during', takenAt: '2026-11-14T10:00:00.000Z',
  fullBlob: new Blob([new Uint8Array(2000).fill(7)], { type: 'image/jpeg' }), thumbBlob: new Blob([new Uint8Array(200)], { type: 'image/jpeg' }), width: 2000, height: 1500, ...over,
});

test('a photo is safe on the phone before any network attempt', async () => {
  const { q, db, server } = await setup();
  const r = await q.enqueue(shot());
  assert.equal(r.pending, true);
  assert.equal(server.calls.length, 0, 'nothing sent yet');
  const rows = await allPhotos(db);
  assert.equal(rows.length, 1);
  assert.equal((await getBlob(db, rows[0].id, 'full')).bytes.byteLength, 2000);
});

test('offline photos are kept, then all arrive once the connection returns, with their capture times', async () => {
  const { q, server, clock } = await setup();
  server.down = true;
  const taken = ['2026-11-14T09:01:00.000Z', '2026-11-14T09:02:00.000Z', '2026-11-14T09:03:00.000Z'];
  for (const t of taken) { await q.enqueue(shot({ takenAt: t })); clock.t += 1000; }
  const r1 = await q.run();
  assert.equal(r1.done, 0);
  assert.equal(r1.stopped, 'network');
  assert.equal(server.rows.size, 0);
  assert.equal((await q.stats()).pending, 3, 'still all waiting');
  // too soon: backoff holds it
  server.calls.length = 0;
  await q.run();
  assert.equal(server.calls.length, 0, 'does not hammer a dead connection');
  // connection back, a while later
  server.down = false; clock.t += 10 * 60 * 1000;
  const r2 = await q.run();
  assert.equal(r2.done, 3);
  assert.deepEqual([...server.rows.values()].map((r) => r.taken_at).sort(), taken);
  assert.equal(server.events.length, 1, 'one history line for the batch');
  assert.equal(server.events[0].details.count, 3);
  const s = await q.stats();
  assert.equal(s.pending, 0);
});

test('"retry now" (force) goes ahead of the backoff', async () => {
  const { q, server } = await setup();
  server.down = true;
  await q.enqueue(shot());
  await q.run();
  server.down = false;
  assert.equal((await q.run()).done, 0, 'still waiting out the delay');
  assert.equal((await q.run({ force: true })).done, 1);
});

test('a drop in the middle resumes where it stopped and never makes a second picture', async () => {
  const { q, server, clock } = await setup();
  await q.enqueue(shot());
  server.failNext = [null, { error: new Error('Failed to fetch') }]; // full file ok, thumbnail fails
  await q.run();
  assert.equal(server.files.size, 1);
  assert.equal(server.rows.size, 0);
  clock.t += 600000;
  server.calls.length = 0;
  await q.run();
  assert.equal(server.calls.filter((c) => c.startsWith('file:')).length, 1, 'only the missing thumbnail was sent');
  assert.equal(server.files.size, 2, 'full file was not sent twice');
  assert.equal(server.rows.size, 1);
});

test('a lost reply after the server saved the row is treated as success, not a duplicate', async () => {
  const { q, server, clock, db } = await setup();
  const r = await q.enqueue(shot());
  // the row is already on the server (the phone never heard back)
  server.rows.set(r.id, { id: r.id });
  for (const kind of ['full', 'thumb']) server.files.set(`job1/${r.id}${kind === 'thumb' ? '_t' : ''}.jpg`, 1);
  const out = await q.run();
  assert.equal(out.done, 1);
  const rec = (await allPhotos(db))[0];
  assert.equal(rec.state, 'done');
  assert.equal(await getBlob(db, rec.id, 'full'), null, 'bytes are removed only after the server confirmed');
  void clock;
});

test('the phone copy is never removed until the server confirms', async () => {
  const { q, db, server, clock } = await setup();
  await q.enqueue(shot());
  for (const err of [new Error('Failed to fetch'), { message: 'Internal', status: 503 }, { message: 'JWT expired' }]) {
    server.rowError = { error: err, status: err.status };
    server.failNext = [];
    await q.run({ force: true });
    clock.t += 1;
    const rec = (await allPhotos(db))[0];
    assert.equal(rec.state, 'pending');
    assert.ok(await getBlob(db, rec.id, 'full'), `bytes kept after ${err.message}`);
  }
});

test('a refusal (job closed) keeps the photo, flags it, and does not stop the others', async () => {
  const { q, db, server } = await setup();
  const a = await q.enqueue(shot({ takenAt: '2026-11-14T09:00:00.000Z' }));
  await q.enqueue(shot({ jobId: 'job2', takenAt: '2026-11-14T09:05:00.000Z' }));
  server.rowError = (row) => (row.job_id === 'job1' ? { error: { code: '42501', message: 'new row violates row-level security policy' }, status: 403 } : null);
  const out = await q.run();
  assert.equal(out.done, 1, 'the second job\'s photo still went through');
  let recs = await allPhotos(db);
  const refused = recs.find((r) => r.id === a.id);
  assert.equal(refused.state, 'blocked');
  assert.ok(await getBlob(db, a.id, 'full'), 'bytes kept');
  assert.equal((await q.stats()).blocked, 1);
  // job reopened: Retry sends it
  server.rowError = null;
  await q.retry(a.id);
  assert.equal((await q.run()).done, 1);
  recs = await allPhotos(db);
  assert.equal(recs.find((r) => r.id === a.id).state, 'done');
});

test('another person signed in on the same phone does not upload this person\'s photos', async () => {
  const { q, server, remote } = await setup({ userId: 'u2' });
  await q.enqueue(shot({ userId: 'u1' }));
  assert.equal((await q.run()).done, 0);
  assert.equal(server.rows.size, 0);
  assert.equal((await q.stats()).others, 1);
  remote.userId = () => 'u1';
  assert.equal((await q.run()).done, 1);
});

test('two runs at once do not double-send', async () => {
  const { q, server } = await setup();
  await q.enqueue(shot());
  await Promise.all([q.run(), q.run(), q.run()]);
  assert.equal(server.rows.size, 1);
  assert.equal(server.calls.filter((c) => c === 'row').length, 1);
});

test('storage that cannot save is reported, not hidden', async () => {
  const { q, db } = await setup();
  db.close();
  await assert.rejects(() => q.enqueue(shot()));
});

test('errors are sorted into the right kind', () => {
  assert.equal(classifyError(new Error('TypeError: Failed to fetch')), 'network');
  assert.equal(classifyError({ message: 'Load failed' }), 'network');
  assert.equal(classifyError({ message: 'JWT expired' }), 'auth');
  assert.equal(classifyError({ message: 'x' }, 401), 'auth');
  assert.equal(classifyError({ code: '42501', message: 'new row violates row-level security policy' }), 'blocked');
  assert.equal(classifyError({ code: '23503', message: 'fk' }), 'blocked');
  assert.equal(classifyError({ code: '23505', message: 'dup' }), 'duplicate');
  assert.equal(classifyError({ message: 'The resource already exists', statusCode: '409' }), 'duplicate');
  assert.equal(classifyError({ message: 'boom' }, 503), 'retry');
  assert.equal(classifyError(null), null);
  assert.ok(backoffMs(1) < backoffMs(5));
  assert.equal(backoffMs(100), backoffMs(50));
});
