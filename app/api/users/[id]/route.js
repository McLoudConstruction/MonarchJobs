import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin, writeAudit } from '@/lib/supabaseAdmin';
import { deleteBlockReason } from '@/lib/newUser';

export const dynamic = 'force-dynamic';

// Owner only. Permanently deletes a login and its staff row. Allowed only for someone who is already
// deactivated, or an invite that was never accepted. Jobs, notes, photos and messages they added stay,
// but no longer show their name.
export async function DELETE(request, { params }) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;

  const admin = getAdmin();
  const { data, error } = await admin.auth.admin.getUserById(params.id);
  const user = data?.user;
  if (error || !user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const { data: staff } = await admin.from('staff_users').select('id,email,full_name,role,active').eq('id', params.id).maybeSingle();
  const reason = deleteBlockReason({
    isSelf: params.id === auth.user.id,
    active: !!staff?.active,
    confirmed: !!user.email_confirmed_at,
  });
  if (reason) return NextResponse.json({ error: reason }, { status: 409 });

  const { error: delErr } = await admin.auth.admin.deleteUser(params.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  await writeAudit({
    actor: { id: auth.user.id, email: auth.staff.email },
    action: 'user.deleted',
    entity: 'staff_users',
    entityId: params.id,
    details: { email: user.email, name: staff?.full_name || null, role: staff?.role || null },
  });
  return NextResponse.json({ ok: true });
}
