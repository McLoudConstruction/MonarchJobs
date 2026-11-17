import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin, writeAudit } from '@/lib/supabaseAdmin';
import { validateNewUser, inviteErrorMessage } from '@/lib/newUser';
import { siteUrl } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

// Owner only. Who has not finished setting up their login, so Settings can offer "Resend invite".
// Returns { statuses: { [userId]: 'invited' | 'no_password' } }. Only people still pending are listed.
//   invited      = the invite email was sent and the link has not been opened yet
//   no_password  = the link was opened (or an older temporary password is still in use) but they
//                  have not chosen their own password yet
export async function GET(request) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;

  const { data, error } = await getAdmin().auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const statuses = {};
  for (const u of data?.users || []) {
    if (!u.email_confirmed_at) statuses[u.id] = 'invited';
    else if (u.user_metadata?.must_change_password === true) statuses[u.id] = 'no_password';
  }
  return NextResponse.json({ statuses });
}

// Owner only. Invites a person by email and adds their staff row, already active.
// Supabase sends the invite email; the link takes them to /accept-invite to choose their own password.
// Body: { email, full_name, role }
export async function POST(request) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  const checked = validateNewUser(body);
  if (checked.error) return NextResponse.json({ error: checked.error }, { status: 400 });
  const { email, full_name, role } = checked.value;

  const admin = getAdmin();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    // must_change_password keeps them on the "Choose your password" screen if they open the link
    // but leave before saving one. It is cleared when they save.
    data: { full_name, must_change_password: true },
    redirectTo: `${siteUrl(request)}/accept-invite`,
  });
  if (error || !data?.user) {
    const { message, status } = inviteErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
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
    action: 'user.invited',
    entity: 'staff_users',
    entityId: data.user.id,
    details: { email, role },
  });
  return NextResponse.json({ ok: true, user: { id: data.user.id, email, full_name, role, active: true } });
}
