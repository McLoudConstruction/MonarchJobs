// Taps and notes made with no signal: "on the way", "started", "finished", and new internal notes. Each is saved on the
// phone with its real time and sent in the order it happened once there is a connection.
//
// Same rules as the photo queue: saved before anything is sent; every operation carries an id so a retry can never apply
// it twice; a network problem pauses and retries; a "no" from the server keeps the operation and flags it; nothing is
// dropped on its own. Within one job, operations go strictly in order: if one is refused, the later ones for that job
// wait behind it (a "finished" must not be applied if its "started" was refused).
import { putOp, allOps, updateOp, deleteOp } from './offlineDb.js';
import { classifyError, backoffMs } from './offlineQueue.js';

export const KEEP_DONE_MS = 24 * 3600 * 1000;

function memoryLocks() {
  let held = false;
  return { run: async (fn) => { if (held) return undefined; held = true; try { return await fn(); } finally { held = false; } } };
}
function webLocks() {
  return { run: (fn) => navigator.locks.request('mj-offline-ops', { ifAvailable: true }, (lock) => (lock ? fn() : undefined)) };
}

// remote.send(op) -> { error?, status?, stale? }   stale: the server already moved past this step (treated as done)
export function createOpsQueue({ db, remote, now = () => Date.now(), onChange = () => {}, onFinished = () => {}, locks = null }) {
  const lock = locks || (typeof navigator !== 'undefined' && navigator.locks ? webLocks() : memoryLocks());
  let pausedUntil = 0;
  let signinNeeded = false;
  const changed = () => { try { onChange(); } catch { /* ignore */ } };

  async function enqueue({ type, jobId, userId, payload }) {
    if (!type || !jobId || !userId) throw new Error('Cannot save this: not signed in.');
    const opId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${now()}-${Math.random().toString(36).slice(2)}`;
    const rec = { opId, type, jobId, userId, payload, at: new Date(now()).toISOString(), createdAt: now(), state: 'pending', attempts: 0, nextTryAt: 0, lastError: '', doneAt: null };
    await putOp(db, rec); // resolves after commit
    changed();
    return rec;
  }

  async function run({ force = false } = {}) {
    const uid = remote.userId();
    const out = { done: 0, remaining: 0, stopped: null };
    if (!force && now() < pausedUntil) { out.stopped = 'paused'; return out; }
    await lock.run(async () => {
      const all = await allOps(db);
      const todo = all.filter((o) => o.state === 'pending' && (!uid || o.userId === uid)).sort((a, b) => a.createdAt - b.createdAt);
      const held = new Set(all.filter((o) => o.state === 'blocked' && (!uid || o.userId === uid)).map((o) => o.jobId)); // jobs with a refused step
      const finished = [];
      for (const op of todo) {
        if (held.has(op.jobId)) continue;
        if (!force && op.nextTryAt > now()) continue;
        let res;
        try { res = await remote.send(op); } catch (e) { res = { error: e }; }
        const kind = res.stale ? 'done' : classifyError(res.error, res.status) || 'done';
        if (kind === 'done' || kind === 'duplicate') {
          await updateOp(db, op.opId, (o) => ({ ...o, state: 'done', doneAt: now(), lastError: res.stale ? 'Already applied or replaced by a later change' : '' }));
          out.done += 1; finished.push(op); signinNeeded = false; changed(); continue;
        }
        if (kind === 'blocked') {
          await updateOp(db, op.opId, (o) => ({ ...o, state: 'blocked', lastError: String(res.error?.message || res.error) }));
          held.add(op.jobId); changed(); continue;
        }
        await updateOp(db, op.opId, (o) => ({ ...o, attempts: o.attempts + (kind === 'auth' ? 0 : 1), nextTryAt: kind === 'auth' ? 0 : now() + backoffMs(o.attempts + 1), lastError: kind === 'network' ? 'Waiting for a connection' : String(res.error?.message || res.error) }));
        out.stopped = kind;
        if (kind === 'auth') signinNeeded = true; else pausedUntil = now() + backoffMs(op.attempts + 1);
        changed();
        break;
      }
      if (finished.length) { pausedUntil = 0; try { onFinished(finished.map((o) => ({ opId: o.opId, jobId: o.jobId, type: o.type }))); } catch { /* ignore */ } }
      for (const o of all) if (o.state === 'done' && o.doneAt && now() - o.doneAt > KEEP_DONE_MS) await deleteOp(db, o.opId);
      out.remaining = (await allOps(db)).filter((o) => o.state === 'pending' && (!uid || o.userId === uid)).length;
    });
    changed();
    return out;
  }

  async function list(jobId = null) {
    const uid = remote.userId();
    return (await allOps(db)).filter((o) => o.state !== 'done' && (!uid || o.userId === uid) && (!jobId || o.jobId === jobId)).sort((a, b) => a.createdAt - b.createdAt);
  }
  async function stats() {
    const l = await list();
    return { pending: l.filter((o) => o.state === 'pending').length, blocked: l.filter((o) => o.state === 'blocked').length, signinNeeded };
  }
  async function retry(opId) { await updateOp(db, opId, (o) => (o.state === 'blocked' ? { ...o, state: 'pending', attempts: 0, nextTryAt: 0, lastError: '' } : o)); changed(); }
  async function discard(opId) { const o = (await allOps(db)).find((x) => x.opId === opId); if (o && o.state === 'blocked') { await deleteOp(db, opId); changed(); } }

  return { enqueue, run, list, stats, retry, discard };
}

// What the page should show while taps are waiting: the visit as it will be once they are sent.
export function overlayVisits(visits, ops) {
  const out = (visits || []).map((v) => ({ ...v }));
  for (const op of ops || []) {
    if (op.type !== 'visit_status' || op.state === 'done') continue;
    const v = out.find((x) => x.id === op.payload.visitId);
    if (!v) continue;
    if (op.payload.action === 'on_the_way') { v.status = 'on_the_way'; v.minutes_out = op.payload.minutes; v.on_the_way_at = op.at; }
    else if (op.payload.action === 'started') { v.status = 'started'; v.started_at = op.at; }
    else if (op.payload.action === 'finished') { v.status = 'finished'; v.finished_at = op.at; }
  }
  return out;
}
