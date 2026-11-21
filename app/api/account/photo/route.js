import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin, writeAudit } from '@/lib/supabaseAdmin';
import { AVATAR_BUCKET, avatarPathFor, avatarBelongsTo, checkAvatarUpload } from '@/lib/avatar';

export const dynamic = 'force-dynamic';

// Any signed-in staff member sets or removes their own profile picture.
// POST multipart form with `file` (the app sends a 256 px square JPEG). DELETE removes it.
export async function POST(request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  let form;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Pick a picture first.' }, { status: 400 });
  const bad = checkAvatarUpload({ size: file.size, type: file.type });
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  const admin = getAdmin();
  const { data: before } = await admin.from('staff_users').select('avatar_path').eq('id', auth.staff.id).maybeSingle();
  const path = avatarPathFor(auth.staff.id, crypto.randomUUID());
  const { error: upErr } = await admin.storage.from(AVATAR_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: 'image/jpeg', upsert: false });
  if (upErr) return NextResponse.json({ error: 'The picture did not upload. Try again.' }, { status: 500 });
  const { error } = await admin.from('staff_users').update({ avatar_path: path }).eq('id', auth.staff.id);
  if (error) {
    await admin.storage.from(AVATAR_BUCKET).remove([path]).catch(() => {});
    return NextResponse.json({ error: /avatar_path|schema cache/i.test(error.message) ? 'Profile photos are not set up yet. Run migration 039.' : error.message }, { status: 500 });
  }
  if (avatarBelongsTo(before?.avatar_path, auth.staff.id)) await admin.storage.from(AVATAR_BUCKET).remove([before.avatar_path]).catch(() => {});
  await writeAudit({ actor: { id: auth.user.id, email: auth.staff.email }, action: 'user.photo_set', entity: 'staff_users', entityId: auth.staff.id });
  return NextResponse.json({ ok: true, avatar_path: path });
}

export async function DELETE(request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  const admin = getAdmin();
  const { data: before } = await admin.from('staff_users').select('avatar_path').eq('id', auth.staff.id).maybeSingle();
  const { error } = await admin.from('staff_users').update({ avatar_path: null }).eq('id', auth.staff.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (avatarBelongsTo(before?.avatar_path, auth.staff.id)) await admin.storage.from(AVATAR_BUCKET).remove([before.avatar_path]).catch(() => {});
  await writeAudit({ actor: { id: auth.user.id, email: auth.staff.email }, action: 'user.photo_removed', entity: 'staff_users', entityId: auth.staff.id });
  return NextResponse.json({ ok: true });
}
