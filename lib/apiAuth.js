import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';

// Verifies the Supabase access token sent as "Authorization: Bearer ..." and loads the
// active staff row. Returns { user, staff } or { error: NextResponse }.
export async function requireStaff(request, allowedRoles = ['owner', 'office', 'tech']) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };

  const admin = getAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };
  }

  const { data: staff } = await admin
    .from('staff_users')
    .select('id,email,full_name,role,active')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!staff || !staff.active || !allowedRoles.includes(staff.role)) {
    return { error: NextResponse.json({ error: 'Not allowed.' }, { status: 403 }) };
  }
  return { user: data.user, staff };
}
