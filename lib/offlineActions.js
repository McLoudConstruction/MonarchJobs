'use client';
// What the screens call. Each tries the server right away and, with no signal, saves the action on the phone instead.
import { getOps, kick } from './offlineClient';
import { lastUser } from './offlineRemote';
import { getSupabase } from './supabaseClient';
import { isNetworkError } from './jobPack';

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

async function token() {
  try { const { data } = await getSupabase().auth.getSession(); return data?.session?.access_token || null; } catch { return null; }
}

// "On the way", "Started", "Finished". Returns { queued: true } when it was saved on the phone to be sent later.
// Throws with the server's message when the server said no.
export async function sendVisitAction({ visit, action, minutes, jobId }) {
  const user = lastUser();
  const save = async () => {
    const ops = await getOps();
    if (!ops || !user?.id) throw new Error('No connection, and this phone cannot save it. Try again with signal.');
    await ops.enqueue({ type: 'visit_status', jobId: jobId || visit.job_id, userId: user.id, payload: { visitId: visit.id, action, minutes } });
    kick();
    return { queued: true };
  };
  if (offline()) return save();
  const t = await token();
  if (!t) return save();
  let res;
  try {
    res = await Promise.race([
      fetch(`/api/visits/${visit.id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ action, minutes }) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 15000)),
    ]);
  } catch { return save(); } // no usable signal
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => ({}));
  if (res.status >= 500) return save();
  throw new Error(body.error || 'Something went wrong.');
}

// A new internal note or progress draft. row: the job_updates columns without id and created_at.
export async function saveNewUpdate({ jobId, row, eventKind }) {
  const user = lastUser();
  const id = globalThis.crypto?.randomUUID?.();
  const full = { ...row, id, job_id: jobId, created_at: new Date().toISOString() };
  const save = async () => {
    const ops = await getOps();
    if (!ops || !user?.id || !id) throw new Error('No connection, and this phone cannot save it. Try again with signal.');
    await ops.enqueue({ type: 'note', jobId, userId: user.id, payload: { row: full, eventKind } });
    kick();
    return { queued: true, row: full };
  };
  if (offline()) return save();
  const sb = getSupabase();
  const r = await Promise.race([
    sb.from('job_updates').insert(full),
    new Promise((resolve) => setTimeout(() => resolve({ error: new Error('timed out') }), 20000)),
  ]);
  if (!r.error) return { ok: true, row: full };
  if (isNetworkError(r.error)) return save();
  throw new Error(r.error.message);
}
