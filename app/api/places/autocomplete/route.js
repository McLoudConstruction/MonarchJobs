import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { placesKey, simplifySuggestions, validSessionToken } from '@/lib/places';

export const dynamic = 'force-dynamic';

// Address suggestions for signed-in staff. Returns { enabled: false } when no key is set so the
// address fields quietly stay plain inputs.
export async function POST(request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  const key = placesKey();
  if (!key) return NextResponse.json({ enabled: false, suggestions: [] });

  const { input, sessionToken } = await request.json().catch(() => ({}));
  const text = (input || '').toString().trim().slice(0, 120);
  if (text.length < 3) return NextResponse.json({ enabled: true, suggestions: [] });

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
      body: JSON.stringify({
        input: text,
        includedRegionCodes: ['us'],
        ...(validSessionToken(sessionToken) ? { sessionToken } : {}),
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error('places autocomplete failed', res.status, (await res.text()).slice(0, 300));
      return NextResponse.json({ enabled: true, suggestions: [], error: 'Address lookup is unavailable.' });
    }
    return NextResponse.json({ enabled: true, suggestions: simplifySuggestions(await res.json()) });
  } catch (e) {
    console.error('places autocomplete error', e.message);
    return NextResponse.json({ enabled: true, suggestions: [], error: 'Address lookup is unavailable.' });
  }
}
