import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { siteUrl } from '@/lib/integrations';
import { runOutreach } from '@/lib/outreachServer';

export const dynamic = 'force-dynamic';

// Owner: who would get a reminder today, without sending anything.
export async function POST(request) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await runOutreach({ admin: getAdmin(), origin: siteUrl(request), dryRun: true }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
