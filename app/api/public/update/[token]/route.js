import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { PHOTO_BUCKET, isUuid } from '@/lib/jobDocs';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// A progress update, found by its secret link. Only updates that were sent are readable. Internal
// notes, staff names and other updates are never returned. Photos come back as one-hour links.
// A view is recorded unless ?preview=1.
export async function GET(request, { params }) {
  const token = params.token;
  if (!isUuid(token)) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });

  const admin = getAdmin();
  const { data: upd } = await admin
    .from('job_updates')
    .select('id,job_id,title,body,next_steps,photo_ids,sent_at,first_viewed_at,view_count')
    .eq('share_token', token)
    .eq('kind', 'progress')
    .eq('status', 'sent')
    .maybeSingle();
  if (!upd) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });

  if (new URL(request.url).searchParams.get('preview') !== '1') {
    const now = new Date().toISOString();
    await admin.from('job_updates').update({ first_viewed_at: upd.first_viewed_at ?? now, last_viewed_at: now, view_count: (upd.view_count || 0) + 1 }).eq('id', upd.id);
  }

  const ids = (upd.photo_ids || []).filter(isUuid);
  const [{ data: job }, { data: settings }, { data: rows }] = await Promise.all([
    admin.from('jobs').select('job_number,job_type,customer:customers(display_name),address:addresses(street,unit,city,state,zip)').eq('id', upd.job_id).maybeSingle(),
    admin.from('settings').select('business_name,phone,email,logo_path').eq('id', 1).maybeSingle(),
    ids.length
      ? admin.from('job_photos').select('id,caption,kind,storage_path,thumb_path,archived_at').eq('job_id', upd.job_id).in('id', ids)
      : Promise.resolve({ data: [] }),
  ]);

  const byId = new Map((rows || []).filter((p) => !p.archived_at).map((p) => [p.id, p]));
  const ordered = ids.map((i) => byId.get(i)).filter(Boolean);
  const paths = ordered.flatMap((p) => [p.storage_path, p.thumb_path]).filter(Boolean);
  const signed = new Map();
  if (paths.length) {
    const { data } = await admin.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
    for (const d of data || []) if (d.signedUrl && !d.error) signed.set(d.path, d.signedUrl);
  }

  return NextResponse.json({
    business: settings || {},
    update: { title: upd.title, body: upd.body, next_steps: upd.next_steps, sent_at: upd.sent_at },
    job: job ? { job_number: job.job_number, job_type: job.job_type, customer: job.customer?.display_name || '', address: job.address } : null,
    photos: ordered
      .map((p) => ({ id: p.id, caption: p.caption, url: signed.get(p.storage_path) || null, thumb_url: signed.get(p.thumb_path) || signed.get(p.storage_path) || null }))
      .filter((p) => p.url),
  }, { headers: NO_STORE });
}
