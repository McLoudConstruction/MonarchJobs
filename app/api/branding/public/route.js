import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// No sign-in needed: the sign-in, invite and reset pages show the business logo before anyone is
// signed in. Returns only the logo's file name. The file itself is in a public bucket and already
// shown to customers on estimates.
export async function GET() {
  try {
    const { data } = await getAdmin().from('settings').select('logo_path').eq('id', 1).maybeSingle();
    return NextResponse.json({ logo_path: data?.logo_path || null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ logo_path: null });
  }
}
