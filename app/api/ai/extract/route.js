import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { scanPicture } from '@/lib/aiServer';
import { AI_KINDS } from '@/lib/aiExtract';
import { todayIn } from '@/lib/invoice';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // reading a picture can take 10 to 20 seconds

// Body: { kind: 'receipt' | 'meter', media_type: 'image/jpeg', image: <base64, no data: prefix> }.
// Receipts: owner and office. Meter screens: also technicians (each kind lists its roles). Returns { ok, provider, result } where
// result holds form values (see normalizeReceipt, normalizeMeter). Nothing is saved.
export async function POST(request) {
  const auth = await requireStaff(request, ['owner', 'office', 'tech']);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => ({}));
  const kind = String(body.kind || '');
  if (!AI_KINDS[kind]) return NextResponse.json({ error: 'Unknown kind of scan.' }, { status: 400 });
  if (!(AI_KINDS[kind].roles || ['owner', 'office']).includes(auth.staff.role)) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  const r = await scanPicture({ kind, mediaType: String(body.media_type || ''), data: String(body.image || ''), staffId: auth.staff.id });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json({ ok: true, provider: r.provider, result: AI_KINDS[kind].normalize(r.raw, { today: todayIn() }) });
}
