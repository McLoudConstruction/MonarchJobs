import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getAdmin } from '@/lib/supabaseAdmin';
import { runWeatherCheck } from '@/lib/weatherServer';

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

// Called every 30 minutes by the database (see migration 050). Asks the National Weather Service for alerts at the business
// location, saves new storm and freeze alerts and tells the right people, and closes alerts that ended.
// Does nothing while both switches in Settings > Outreach are off.
export async function POST(request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  try {
    const result = await runWeatherCheck({ admin: getAdmin() });
    return NextResponse.json({ ok: !result.error, ...result });
  } catch (e) {
    console.error('weather check failed:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
