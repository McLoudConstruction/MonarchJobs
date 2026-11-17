// The real connection the photo queue uses: Supabase storage and tables, called from the browser as the signed-in
// person. Every call has a time limit, so a bad signal ("one bar") counts as no connection instead of hanging forever.
import { PHOTO_BUCKET } from './jobDocs.js';

const UPLOAD_TIMEOUT_MS = 90_000;
const CALL_TIMEOUT_MS = 30_000;

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(() => resolve({ error: new Error('The request timed out') }), ms)),
]);

const LAST_USER = 'mj-last-user';
export const rememberUser = (u) => { try { if (u?.id) localStorage.setItem(LAST_USER, JSON.stringify({ id: u.id, email: u.email || '' })); } catch { /* storage blocked */ } };
export const lastUser = () => { try { return JSON.parse(localStorage.getItem(LAST_USER) || 'null'); } catch { return null; } };
export const forgetUser = () => { try { localStorage.removeItem(LAST_USER); } catch { /* nothing to do */ } };

export function createRemote(sb) {
  return {
    // Works with no signal: the id comes from what was saved at sign-in.
    userId: () => lastUser()?.id || null,

    async uploadFile(path, blob, contentType) {
      try {
        const r = await withTimeout(
          sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType, cacheControl: '31536000', upsert: false }),
          UPLOAD_TIMEOUT_MS,
        );
        return { error: r.error || null, status: r.error?.statusCode ? Number(r.error.statusCode) : 0 };
      } catch (e) { return { error: e }; }
    },

    async insertPhoto(row) {
      try {
        const r = await withTimeout(sb.from('job_photos').insert(row), CALL_TIMEOUT_MS);
        return { error: r.error || null, status: r.status || 0 };
      } catch (e) { return { error: e }; }
    },

    async archivePhoto(id) {
      try {
        const r = await withTimeout(sb.from('job_photos').update({ archived_at: new Date().toISOString() }).eq('id', id), CALL_TIMEOUT_MS);
        return { error: r.error || null };
      } catch (e) { return { error: e }; }
    },

    async logEvent(jobId, kind, details) {
      try {
        const u = lastUser();
        const r = await withTimeout(sb.from('job_events').insert({ job_id: jobId, actor_id: u?.id || null, actor_email: u?.email || null, kind, details }), CALL_TIMEOUT_MS);
        return { error: r.error || null };
      } catch (e) { return { error: e }; }
    },
  };
}
