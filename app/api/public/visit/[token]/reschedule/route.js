import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { siteUrl } from '@/lib/integrations';
import { rescheduleOptions, rescheduleVisit } from '@/lib/rescheduleServer';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

// The open times a customer can move their visit to. The secret visit link is the access.
export async function GET(request, { params }) {
  const out = await rescheduleOptions(getAdmin(), params.token);
  if (out.error) return NextResponse.json({ error: out.error, reason: out.reason }, { status: out.status, headers: NO_STORE });
  return NextResponse.json(out, { headers: NO_STORE });
}

// { start } moves the visit to that time. The server checks the time is still open and the rules still allow it.
export async function POST(request, { params }) {
  const body = await request.json().catch(() => ({}));
  if (!Number.isFinite(Date.parse(body?.start))) return NextResponse.json({ error: 'Please pick a time.' }, { status: 400, headers: NO_STORE });
  const out = await rescheduleVisit({ admin: getAdmin(), token: params.token, startIso: body.start, origin: siteUrl(request) });
  if (out.error) return NextResponse.json({ error: out.error, code: out.code }, { status: out.status, headers: NO_STORE });
  return NextResponse.json({ ok: true, start: out.start, end: out.end }, { headers: NO_STORE });
}
