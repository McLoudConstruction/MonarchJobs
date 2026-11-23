import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { runAnomalyCheck } from '@/lib/anomalyServer';

export const dynamic = 'force-dynamic';

// Owner: which job alerts would go out right now, without sending anything.
export async function POST(request) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await runAnomalyCheck({ admin: getAdmin(), dryRun: true }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
