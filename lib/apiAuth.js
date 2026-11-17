import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';

// Verifies the Supabase access token sent as "Authorization: Bearer ..." and loads the
// active staff row. Returns { user, staff } or { error: NextResponse }.
export async function requireStaff(request, allowedRoles = ['owner', 'office', 'tech']) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { error: NextResponse.json({ error: 'Not signed in. (The browser sent no login token.)' }, { status: 401 }) };

  const admin = getAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    // Say why, so "Not signed in" while clearly signed in can be traced (a bad server key and an
    // expired login token look identical otherwise). Nothing secret is in this message.
    const why = error?.message || 'no user returned';
    console.error('requireStaff: token check failed:', why);
    return { error: NextResponse.json({ error: `Not signed in. (Server could not verify the login: ${why})` }, { status: 401 }) };
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

// For pages that work for everyone but give more to signed-in staff (the booking page). No login token means
// { staff: null }. A token that is present but not valid is an error, so a stale sign-in is never quietly treated as a
// customer.
export async function optionalStaff(request) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return { staff: null };
  const auth = await requireStaff(request);
  if (auth.error) return { error: auth.error };
  return { staff: auth.staff };
}
