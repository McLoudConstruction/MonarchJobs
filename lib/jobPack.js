// Everything the job page needs, fetched in one go, so a copy can be kept on the phone and the page can open with no
// signal. Used by the job page itself and by "get ready for the day" (which saves today's jobs before the tech leaves
// a place with signal).
import { classifyError } from './offlineQueue.js';

export const isNetworkError = (err) => !!err && ['network', 'retry'].includes(classifyError(err, err?.status));
export const packKey = (jobId) => `job:${jobId}`;

export async function fetchJobPack(sb, id, isOffice) {
  const { data: job, error } = await sb.from('jobs')
    .select('*,customer:customers(id,display_name,first_name,last_name,company_name,phone,email,customer_type),address:addresses(*)')
    .eq('id', id).maybeSingle();
  if (error) return { error };
  if (!job) return { job: null };
  const [v, ct, jc, ev, st, ph, sk, up] = await Promise.all([
    sb.from('job_visits').select('*').eq('job_id', id).order('starts_at'),
    isOffice ? sb.from('contacts').select('*').eq('customer_id', job.customer_id) : Promise.resolve({ data: [] }),
    sb.from('job_contacts').select('contact_id').eq('job_id', id),
    sb.from('job_events').select('*').eq('job_id', id).order('at', { ascending: false }).limit(50),
    sb.from('staff_users').select('id,full_name,email,role').eq('active', true),
    sb.from('job_photos').select('*').eq('job_id', id).order('taken_at', { ascending: false }),
    sb.from('job_sketches').select('id,name,sort_order,created_at,plan,updated_at').eq('job_id', id).order('sort_order').order('created_at'),
    sb.from('job_updates').select('*').eq('job_id', id).order('created_at', { ascending: false }),
  ]);
  const firstError = [v, ct, jc, ev, st, ph, sk, up].find((r) => r.error && isNetworkError(r.error))?.error;
  if (firstError) return { error: firstError };
  return { job, visits: v.data || [], contacts: ct.data || [], jobContacts: jc.data || [], events: ev.data || [], staff: st.data || [], photos: ph, sketches: sk, updates: up };
}
