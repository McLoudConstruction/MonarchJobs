import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin, writeAudit } from '@/lib/supabaseAdmin';
import { inviteErrorMessage } from '@/lib/newUser';
import { siteUrl } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

// Owner only. Sends a fresh email to someone who has not finished setting up their login.
//   Link never opened  -> a new invite email (to /accept-invite)
//   Link opened, no password chosen, or still on an old temporary password -> a password reset email
// Someone who already chose their own password gets a 409: they can use "Forgot password" instead.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;

  const admin = getAdmin();
  const { data, error } = await admin.auth.admin.getUserById(params.id);
  const user = data?.user;
  if (error || !user?.email) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const origin = siteUrl(request);
  let action;
  let sendError;
  if (!user.email_confirmed_at) {
    action = 'user.invite_resent';
    ({ error: sendError } = await admin.auth.admin.inviteUserByEmail(user.email, {
      data: { full_name: user.user_metadata?.full_name || '', must_change_password: true },
      redirectTo: `${origin}/accept-invite`,
    }));
  } else if (user.user_metadata?.must_change_password === true) {
    action = 'user.reset_sent';
    ({ error: sendError } = await admin.auth.resetPasswordForEmail(user.email, { redirectTo: `${origin}/reset-password` }));
  } else {
    return NextResponse.json({ error: 'They have already chosen their password. They can use "Forgot password?" on the sign-in page if they need a new one.' }, { status: 409 });
  }

  if (sendError) {
    const { message, status } = inviteErrorMessage(sendError);
    return NextResponse.json({ error: message }, { status });
  }

  await writeAudit({
    actor: { id: auth.user.id, email: auth.staff.email },
    action,
    entity: 'staff_users',
    entityId: user.id,
    details: { email: user.email },
  });
  return NextResponse.json({ ok: true, email: user.email });
}
