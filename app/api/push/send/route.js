import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { sendPushForNotifications } from '@/lib/pushServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Called by the database (pg_net) right after it writes notifications. Not a browser endpoint:
// it needs "Authorization: Bearer <secret>", the same value saved in notification_config.
function authorized(request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Body: { ids: [notification ids] }
export async function POST(request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger).slice(0, 200) : [];
  if (!ids.length) return NextResponse.json({ ok: true, sent: 0 });
  const result = await sendPushForNotifications(ids);
  return NextResponse.json({ ok: true, ...result });
}
