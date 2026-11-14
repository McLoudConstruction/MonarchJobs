import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getAdmin } from '@/lib/supabaseAdmin';
import { siteUrl } from '@/lib/integrations';
import { runOutreach } from '@/lib/outreachServer';

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

// Called once a day by the database (see migration 015). Sends rebooking reminders, plan offers and plan reminders
// that are due. Which ones are on is set in Settings > Reminders.
export async function POST(request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  try {
    const result = await runOutreach({ admin: getAdmin(), origin: siteUrl(request) });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
