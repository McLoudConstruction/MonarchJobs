import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { ensureCoords } from '@/lib/googleServer';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Office and owner. Looks up map coordinates for saved addresses that do not have them yet (20 per call) and saves them.
// { address_ids: [...] } -> { coords: { id: { lat, lng } }, failed: [id], remaining, error }
export async function POST(request) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => ({}));
  const ids = [...new Set((Array.isArray(body.address_ids) ? body.address_ids : []).filter((x) => typeof x === 'string' && UUID.test(x)))].slice(0, 100);
  if (!ids.length) return NextResponse.json({ coords: {}, failed: [], remaining: 0, error: '' });
  const admin = getAdmin();
  const { data, error } = await admin.from('addresses').select('id,street,unit,city,state,zip,lat,lng,geocode_status').in('id', ids);
  if (error) return NextResponse.json({ error: 'Could not read the addresses.' }, { status: 500 });
  const out = await ensureCoords(admin, data || [], 20);
  return NextResponse.json({ coords: Object.fromEntries(out.coords), failed: [...out.failed], remaining: out.remaining, error: out.error });
}
