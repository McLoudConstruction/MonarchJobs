import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, allOps } from '../lib/offlineDb.js';
import { createOpsQueue, overlayVisits } from '../lib/offlineOps.js';

async function setup() {
  globalThis.indexedDB = new (await import('fake-indexeddb')).IDBFactory();
  const db = await openDb();
  const clock = { t: 5_000_000 };
  const server = { applied: [], down: false, reply: () => ({}) };
  const remote = {
    userId: () => 'u1',
    async send(op) {
      if (server.down) return { error: new Error('TypeError: Failed to fetch') };
      const r = server.reply(op);
      if (!r.error && !r.stale) server.applied.push(`${op.type}:${op.payload.action || op.payload.id}`);
      return r;
    },
  };
  const q = createOpsQueue({ db, remote, now: () => clock.t });
  return { db, q, server, clock };
}
const tap = (q, action, jobId = 'j1') => q.enqueue({ type: 'visit_status', jobId, userId: 'u1', payload: { visitId: 'v1', action, minutes: 20 } });

test('taps made offline are applied in the order they were made, once there is signal', async () => {
  const { q, server, clock } = await setup();
  server.down = true;
  await tap(q, 'on_the_way'); clock.t += 1000;
  await tap(q, 'started'); clock.t += 1000;
  await tap(q, 'finished');
  assert.equal((await q.run()).done, 0);
  assert.equal((await q.stats()).pending, 3);
  server.down = false;
  const out = await q.run({ force: true });
  assert.equal(out.done, 3);
  assert.deepEqual(server.applied, ['visit_status:on_the_way', 'visit_status:started', 'visit_status:finished']);
});

test('each tap keeps the time it was made, not the time it was sent', async () => {
  const { q, db, clock } = await setup();
  const o = await tap(q, 'started');
  clock.t += 3 * 3600 * 1000;
  assert.equal(new Date(o.at).getTime(), 5_000_000);
  const stored = (await allOps(db))[0];
  assert.equal(stored.at, o.at);
});

test('a step the server refused holds back the later steps for that job, not for other jobs', async () => {
  const { q, server } = await setup();
  await tap(q, 'started', 'j1');
  await tap(q, 'finished', 'j1');
  await tap(q, 'started', 'j2');
  server.reply = (op) => (op.jobId === 'j1' ? { error: { message: 'This job is cancelled.' }, status: 403 } : {});
  const out = await q.run();
  assert.equal(out.done, 1, 'only j2 went through');
  const s = await q.stats();
  assert.equal(s.blocked, 1);
  assert.equal(s.pending, 1, 'j1 finished waits behind the refused start');
  assert.deepEqual(server.applied, ['visit_status:started']);
});

test('a step the server has already moved past counts as done', async () => {
  const { q, server } = await setup();
  await tap(q, 'on_the_way');
  server.reply = () => ({ stale: true });
  assert.equal((await q.run()).done, 1);
  assert.equal((await q.stats()).pending, 0);
});

test('a retry after a lost reply is safe because the server recognises the operation id', async () => {
  const { q, server } = await setup();
  const o = await tap(q, 'started');
  const seen = new Set();
  server.reply = (op) => { if (seen.has(op.opId)) return { stale: true }; seen.add(op.opId); return { error: new Error('Failed to fetch') }; };
  await q.run();                       // the request was applied but the reply never came back
  server.reply = (op) => (seen.has(op.opId) ? { stale: true } : {});
  const out = await q.run({ force: true });
  assert.equal(out.done, 1);
  assert.equal(server.applied.length, 0, 'applied once by the server, not again');
  void o;
});

test('waiting taps show on the visit while offline', () => {
  const visits = [{ id: 'v1', status: 'scheduled' }, { id: 'v2', status: 'scheduled' }];
  const ops = [
    { type: 'visit_status', state: 'pending', at: 'T1', payload: { visitId: 'v1', action: 'on_the_way', minutes: 30 } },
    { type: 'visit_status', state: 'pending', at: 'T2', payload: { visitId: 'v1', action: 'started' } },
  ];
  const out = overlayVisits(visits, ops);
  assert.equal(out[0].status, 'started');
  assert.equal(out[0].minutes_out, 30);
  assert.equal(out[1].status, 'scheduled');
  assert.equal(visits[0].status, 'scheduled', 'the original is not changed');
});
