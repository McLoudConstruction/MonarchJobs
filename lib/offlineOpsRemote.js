// Sends one saved tap or note to the server. Returns { error?, status?, stale? } (see lib/offlineOps.js).
const TIMEOUT_MS = 25_000;

const timeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve({ error: new Error('The request timed out') }), ms))]);

export function createOpsRemote(sb, userId) {
  async function token() {
    try { const { data } = await sb.auth.getSession(); return data?.session?.access_token || null; } catch { return null; }
  }

  async function sendVisit(op) {
    const t = await token();
    if (!t) return { error: { message: 'jwt expired' }, status: 401 };
    let res;
    try {
      res = await timeout(fetch(`/api/visits/${op.payload.visitId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ action: op.payload.action, minutes: op.payload.minutes, at: op.at, op_id: op.opId, replay: true }),
      }), TIMEOUT_MS);
    } catch (e) { return { error: e }; }
    if (res.error) return { error: res.error };
    if (res.ok) return {};
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && body.code === 'STALE') return { stale: true };
    if (res.status === 409 && body.code === 'CHANGED') return { error: { message: body.error || 'The visit just changed' }, status: 503 }; // try again
    if (res.status === 401) return { error: { message: 'jwt expired' }, status: 401 };
    return { error: { message: body.error || `The server said no (${res.status}).` }, status: res.status === 409 ? 403 : res.status };
  }

  async function sendNote(op) {
    const r = await timeout(sb.from('job_updates').insert(op.payload.row), 30_000);
    if (r.error) return { error: r.error, status: r.status };
    await timeout(sb.from('job_events').insert({ job_id: op.jobId, actor_id: userId, kind: op.payload.eventKind, details: { category: op.payload.row.category || '', offline: true } }), 30_000).catch(() => null);
    return {};
  }

  return {
    userId: () => userId(),
    async send(op) {
      try {
        if (op.type === 'visit_status') return await sendVisit(op);
        if (op.type === 'note') return await sendNote(op);
        return { error: { message: 'Unknown saved action.' }, status: 400 };
      } catch (e) { return { error: e }; }
    },
  };
}
