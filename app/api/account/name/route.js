import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin, writeAudit } from '@/lib/supabaseAdmin';
import { validateName } from '@/lib/newUser';

export const dynamic = 'force-dynamic';

// Any signed-in staff member can set their own name. Body: { full_name }
export async function PUT(request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  const checked = validateName(body?.full_name);
  if (checked.error) return NextResponse.json({ error: checked.error }, { status: 400 });

  const admin = getAdmin();
  const { error } = await admin.from('staff_users').update({ full_name: checked.value }).eq('id', auth.staff.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await writeAudit({
    actor: { id: auth.user.id, email: auth.staff.email },
    action: 'user.name_set',
    entity: 'staff_users',
    entityId: auth.staff.id,
  });
  return NextResponse.json({ ok: true, full_name: checked.value });
}
