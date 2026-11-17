import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { loadSchedulable, loadOpenSlots } from '@/lib/bookingServer';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The open times a customer can pick after approving their estimate. The secret estimate link is the access.
export async function GET(request, { params }) {
  if (!UUID.test(params.token)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const admin = getAdmin();
  const found = await loadSchedulable(admin, params.token);
  if (found.error) return NextResponse.json({ error: found.error }, { status: found.status });
  return NextResponse.json(await loadOpenSlots(admin, found.settings));
}
