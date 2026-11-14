'use client';
// "Get ready for the day": while there is signal, save the jobs a person is booked on for the next few days (job
// details, visits, photos list, sketches, notes) and their pages, so they open with no signal in a basement.
import { fetchJobPack, packKey } from './jobPack';
import { cacheWrite, metaRead, metaWrite } from './offlineClient';

const EVERY_MS = 20 * 60 * 1000;
const MAX_JOBS = 15;

export async function savePackLocally(id, pack) {
  await cacheWrite(packKey(id), pack);
  for (const sk of pack.sketches?.data || []) await cacheWrite(`sketch:${sk.id}`, { id: sk.id, name: sk.name, plan: sk.plan, updated_at: sk.updated_at });
}

export async function warmUpcoming(sb, staff, { force = false } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
  const last = await metaRead('warm_at');
  if (!force && last && Date.now() - last < EVERY_MS) return 0;
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 3 * 24 * 3600 * 1000);
  const { data, error } = await sb.from('job_visits').select('job_id')
    .eq('tech_id', staff.id).in('status', ['scheduled', 'on_the_way', 'started'])
    .gte('starts_at', from.toISOString()).lte('starts_at', to.toISOString()).limit(60);
  if (error) return 0;
  const ids = [...new Set((data || []).map((v) => v.job_id))].slice(0, MAX_JOBS);
  let saved = 0;
  for (const id of ids) {
    try {
      const pack = await fetchJobPack(sb, id, staff.role !== 'tech');
      if (!pack.error && pack.job) { await savePackLocally(id, pack); saved += 1; }
    } catch { /* one job failing must not stop the rest */ }
  }
  try {
    const sw = await navigator.serviceWorker?.ready;
    sw?.active?.postMessage({ type: 'warm', urls: [...ids.map((id) => `/jobs/${id}`), '/dashboard', '/queue', '/jobs', '/schedule'] });
  } catch { /* no service worker here */ }
  await metaWrite('warm_at', Date.now());
  return saved;
}
