import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin, writeAudit } from '@/lib/supabaseAdmin';
import { validateNewUser } from '@/lib/newUser';

export const dynamic = 'force-dynamic';

// Owner only. Creates a login (email + password) and the matching staff row, already active.
// Body: { email, full_name, role, password }
export async function POST(request) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  const checked = validateNewUser(body);
  if (checked.error) return NextResponse.json({ error: checked.error }, { status: 400 });
  const { email, full_name, role, password } = checked.value;

  const admin = getAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation email: they can sign in right away
    user_metadata: { full_name, must_change_password: true },
  });
  if (error || !data?.user) {
    const msg = error?.message || 'Could not create the user.';
    const exists = /already|registered|exists/i.test(msg);
    return NextResponse.json({ error: exists ? 'That email already has an account.' : msg }, { status: exists ? 409 : 400 });
  }

  // A database trigger adds the staff row as an inactive tech. Set the chosen role and activate it.
  const { error: staffErr } = await admin.from('staff_users').upsert(
    { id: data.user.id, email, full_name, role, active: true },
    { onConflict: 'id' }
  );
  if (staffErr) {
    // Do not leave a login with no usable staff row behind.
    await admin.auth.admin.deleteUser(data.user.id);
    return NextResponse.json({ error: `Could not save the user: ${staffErr.message}` }, { status: 500 });
  }

  await writeAudit({
    actor: { id: auth.user.id, email: auth.staff.email },
    action: 'user.created',
    entity: 'staff_users',
    entityId: data.user.id,
    details: { email, role },
  });
  return NextResponse.json({ ok: true, user: { id: data.user.id, email, full_name, role, active: true } });
}
