import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getAdmin } from '@/lib/supabaseAdmin';
import { runAnomalyCheck } from '@/lib/anomalyServer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request) {
  const header = request.headers.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const secrets = [process.env.PUSH_WEBHOOK_SECRET, process.env.CRON_SECRET].filter(Boolean);
  const a = Buffer.from(given);
  return secrets.some((s) => {
    const b = Buffer.from(s);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

// Called every hour by the database (see migration 042). Tells the owner when an open job's hours, cost or equipment days pass
// the limits set in Settings > Reminders. Does nothing while the switch there is off.
export async function POST(request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  try {
    const result = await runAnomalyCheck({ admin: getAdmin() });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
