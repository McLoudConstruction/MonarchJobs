import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { runWeatherCheck } from '@/lib/weatherServer';
import { parseLocation } from '@/lib/weather';

export const dynamic = 'force-dynamic';

// Owner: what weather alerts are active at the business location right now. Sends nothing.
// If the page passes the alert area as typed, that one field is saved first (nothing else on the Settings page is touched).
export async function POST(request) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => ({}));
  const admin = getAdmin();
  let saved = null;
  if (typeof body.location === 'string') {
    const text = body.location.trim().slice(0, 60);
    if (!parseLocation(text)) return NextResponse.json({ error: 'Enter a 5-digit ZIP code for the alert area, for example 64801, or coordinates like 37.21, -93.29.' }, { status: 400 });
    const { data: cur } = await admin.from('settings').select('weather_location').eq('id', 1).maybeSingle();
    if ((cur?.weather_location || '') !== text) {
      // a new place: forget the remembered map point so it is looked up again
      const { error } = await admin.from('settings').update({ weather_location: text, weather_lat: null, weather_lng: null, weather_geo_for: null }).eq('id', 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      saved = text;
    }
  }
  try {
    const out = await runWeatherCheck({ admin, dryRun: true });
    if (out.error) return NextResponse.json({ error: out.error }, { status: 400 });
    return NextResponse.json({ ...out, saved });
  } catch (e) {
    return NextResponse.json({ error: `Could not reach the weather service. ${e.message}` }, { status: 502 });
  }
}
