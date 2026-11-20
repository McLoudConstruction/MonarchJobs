import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { PHOTO_BUCKET, isUuid } from '@/lib/jobDocs';
import { publicPhoto, shareState } from '@/lib/photoShare';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

// A photo share link, found by its secret token. Returns 404 when the link is switched off or has expired.
// Only the picture, its caption (if the office allows) and the day it was taken leave here: never location,
// tags, who took it, voice notes, or staff names. A view is recorded unless ?preview=1.
export async function GET(request, { params }) {
  const token = params.token;
  if (!isUuid(token)) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });
  const admin = getAdmin();
  const { data: sh } = await admin
    .from('photo_shares')
    .select('id,job_id,title,photo_ids,show_captions,expires_at,revoked_at,view_count')
    .eq('token', token)
    .maybeSingle();
  if (!sh || shareState(sh) !== 'live') return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });

  if (new URL(request.url).searchParams.get('preview') !== '1') {
    await admin.from('photo_shares').update({ view_count: (sh.view_count || 0) + 1, last_viewed_at: new Date().toISOString() }).eq('id', sh.id);
  }

  const ids = (sh.photo_ids || []).filter(isUuid);
  const [{ data: job }, { data: settings }, { data: rows }] = await Promise.all([
    admin.from('jobs').select('job_number,address:addresses(street,unit,city,state,zip)').eq('id', sh.job_id).maybeSingle(),
    admin.from('settings').select('business_name,phone,email,logo_path').eq('id', 1).maybeSingle(),
    admin.from('job_photos').select('id,caption,taken_at,storage_path,thumb_path,archived_at').eq('job_id', sh.job_id).in('id', ids),
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
    title: sh.title,
    job: job ? { job_number: job.job_number, address: job.address } : null,
    photos: ordered
      .map((p) => publicPhoto(p, { showCaptions: sh.show_captions, url: signed.get(p.storage_path) || null, thumbUrl: signed.get(p.thumb_path) || null }))
      .filter((p) => p.url),
  }, { headers: NO_STORE });
}
