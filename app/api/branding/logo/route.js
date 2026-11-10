import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin, writeAudit } from '@/lib/supabaseAdmin';
import { LOGO_BUCKET, LOGO_MAX_BYTES, LOGO_TYPES, sniffImageType } from '@/lib/branding';

export const dynamic = 'force-dynamic';

// Owner only. Body: multipart form with a "file" field (PNG, JPG or WebP, up to 2 MB).
// Saves the file to the public "branding" bucket under a new name each time (so browsers never
// show a stale logo), points settings.logo_path at it, then removes the previous file.
export async function POST(request) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Could not read the upload.' }, { status: 400 });
  }
  const file = form.get('file');
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'Choose an image file first.' }, { status: 400 });
  }
  if (file.size > LOGO_MAX_BYTES) {
    return NextResponse.json({ error: 'That file is larger than 2 MB. Use a smaller image.' }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) {
    return NextResponse.json({ error: 'Use a PNG, JPG or WebP image.' }, { status: 400 });
  }

  const admin = getAdmin();
  const path = `logo-${Date.now()}.${LOGO_TYPES[type]}`;
  const { error: upErr } = await admin.storage.from(LOGO_BUCKET).upload(path, bytes, { contentType: type, cacheControl: '31536000', upsert: false });
  if (upErr) {
    const hint = /bucket/i.test(upErr.message) ? ' Run migration 006 in Supabase first.' : '';
    return NextResponse.json({ error: `Upload failed: ${upErr.message}.${hint}` }, { status: 500 });
  }

  const { data: before } = await admin.from('settings').select('logo_path').eq('id', 1).maybeSingle();
  const { error: dbErr } = await admin.from('settings').update({ logo_path: path }).eq('id', 1);
  if (dbErr) {
    await admin.storage.from(LOGO_BUCKET).remove([path]);
    return NextResponse.json({ error: `Could not save the logo: ${dbErr.message}` }, { status: 500 });
  }
  if (before?.logo_path && before.logo_path !== path) {
    await admin.storage.from(LOGO_BUCKET).remove([before.logo_path]);
  }

  await writeAudit({ actor: { id: auth.user.id, email: auth.staff.email }, action: 'branding.logo_saved', entity: 'settings', entityId: '1' });
  return NextResponse.json({ ok: true, logo_path: path });
}

export async function DELETE(request) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;

  const admin = getAdmin();
  const { data: before } = await admin.from('settings').select('logo_path').eq('id', 1).maybeSingle();
  const { error } = await admin.from('settings').update({ logo_path: null }).eq('id', 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (before?.logo_path) await admin.storage.from(LOGO_BUCKET).remove([before.logo_path]);

  await writeAudit({ actor: { id: auth.user.id, email: auth.staff.email }, action: 'branding.logo_removed', entity: 'settings', entityId: '1' });
  return NextResponse.json({ ok: true });
}
