import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { isUuid, PHOTO_BUCKET } from '@/lib/jobDocs';

export const dynamic = 'force-dynamic';

// Moves one photo to another job (for a picture filed on the wrong job). Office and owner only.
// Body { job_number }. The photo keeps the time it was taken, where, who took it and its tags; it leaves any room (rooms
// belong to a job's sketch) and any before/after link. The files are filed under the job's id, so they are copied to the
// new job's folder first and the old ones are removed only after the photo row points at the new ones.
// A photo that is part of an update on its current job is not moved, because that would silently take it out of the update.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  if (!isUuid(params.id) || !isUuid(params.photoId)) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const number = Number(String(body?.job_number ?? '').replace(/[^\d]/g, ''));
  if (!Number.isInteger(number) || number <= 0) return NextResponse.json({ error: 'Type the job number to move it to.' }, { status: 400 });

  const admin = getAdmin();
  const [{ data: photo }, { data: from }, { data: to }] = await Promise.all([
    admin.from('job_photos').select('id,job_id,storage_path,thumb_path,original_path').eq('id', params.photoId).eq('job_id', params.id).maybeSingle(),
    admin.from('jobs').select('id,job_number').eq('id', params.id).maybeSingle(),
    admin.from('jobs').select('id,job_number').eq('job_number', number).maybeSingle(),
  ]);
  if (!photo || !from) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });
  if (!to) return NextResponse.json({ error: `There is no job #${number}.` }, { status: 404 });
  if (to.id === from.id) return NextResponse.json({ error: 'That photo is already on this job.' }, { status: 400 });

  const { data: used } = await admin.from('job_updates').select('id').eq('job_id', from.id).contains('photo_ids', [photo.id]);
  if (used && used.length) {
    return NextResponse.json({ error: `This photo is used in ${used.length === 1 ? 'an update' : `${used.length} updates`} on this job. Take it out of ${used.length === 1 ? 'that update' : 'those updates'} first, then move it.` }, { status: 409 });
  }

  const bucket = admin.storage.from(PHOTO_BUCKET);
  const name = (p) => String(p).split('/').pop();
  const pairs = [photo.storage_path, photo.thumb_path, photo.original_path].filter(Boolean).map((old) => ({ old, next: `${to.id}/${name(old)}` }));
  const copied = [];
  for (const f of pairs) {
    const { error } = await bucket.copy(f.old, f.next);
    if (error && !/already exists|duplicate/i.test(error.message || '')) {
      if (copied.length) await bucket.remove(copied);
      return NextResponse.json({ error: `Could not copy the picture: ${error.message}` }, { status: 502 });
    }
    copied.push(f.next);
  }
  const at = (old) => (old ? `${to.id}/${name(old)}` : null);
  const { error: upErr } = await admin.from('job_photos').update({
    job_id: to.id, storage_path: at(photo.storage_path), thumb_path: at(photo.thumb_path), original_path: at(photo.original_path),
    sketch_id: null, room_key: null, pair_of: null,
  }).eq('id', photo.id).eq('job_id', from.id);
  if (upErr) {
    await bucket.remove(copied);
    return NextResponse.json({ error: `Could not move the photo: ${upErr.message}` }, { status: 500 });
  }
  await admin.from('job_photos').update({ pair_of: null }).eq('pair_of', photo.id); // photos that pointed at it as their "before"
  await bucket.remove(pairs.map((f) => f.old)); // the photo row now points at the new files

  const actor = { actor_id: auth.staff.id, actor_email: auth.staff.email };
  await admin.from('job_events').insert([
    { job_id: from.id, ...actor, kind: 'photo_moved', details: { photo_id: photo.id, to_job: to.job_number } },
    { job_id: to.id, ...actor, kind: 'photo_moved', details: { photo_id: photo.id, from_job: from.job_number } },
  ]);
  return NextResponse.json({ ok: true, to_job: to.job_number });
}
