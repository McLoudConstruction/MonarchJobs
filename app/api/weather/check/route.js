import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { runWeatherCheck } from '@/lib/weatherServer';

export const dynamic = 'force-dynamic';

// Owner: what weather alerts are active at the business location right now. Saves and sends nothing.
export async function POST(request) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  try {
    const out = await runWeatherCheck({ admin: getAdmin(), dryRun: true });
    if (out.error) return NextResponse.json({ error: out.error }, { status: 400 });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: `Could not reach the weather service. ${e.message}` }, { status: 502 });
  }
}
