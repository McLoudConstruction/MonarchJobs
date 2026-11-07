import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { placesKey, parseAddressComponents, validSessionToken } from '@/lib/places';

export const dynamic = 'force-dynamic';

// Street, city, state and ZIP for a chosen suggestion.
export async function GET(request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  const key = placesKey();
  if (!key) return NextResponse.json({ error: 'Address lookup is not set up.' }, { status: 404 });

  const params = new URL(request.url).searchParams;
  const placeId = params.get('placeId') || '';
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) return NextResponse.json({ error: 'Bad place.' }, { status: 400 });
  const session = params.get('sessionToken');

  try {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${validSessionToken(session) ? `?sessionToken=${session}` : ''}`;
    const res = await fetch(url, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'addressComponents' },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error('places details failed', res.status, (await res.text()).slice(0, 300));
      return NextResponse.json({ error: 'Address lookup failed.' }, { status: 502 });
    }
    const body = await res.json();
    return NextResponse.json({ address: parseAddressComponents(body.addressComponents) });
  } catch (e) {
    console.error('places details error', e.message);
    return NextResponse.json({ error: 'Address lookup failed.' }, { status: 502 });
  }
}
