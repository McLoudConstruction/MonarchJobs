import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID } from '@/lib/invoiceServer';
import { syncLedgerEntry } from '@/lib/clockServer';

export const dynamic = 'force-dynamic';

const MAX_MS = 24 * 3600 * 1000;

// The owner fixes a time entry directly (no request needed), or removes it. Body: { started_at, ended_at } or { void: true, reason? }.
// A removed entry stays on the list as removed and no longer counts.
export async function PATCH(request, { params }) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Time entry not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const admin = getAdmin();
  const { data: session } = await admin.from('job_clock_sessions').select('*').eq('id', params.id).maybeSingle();
  if (!session) return NextResponse.json({ error: 'Time entry not found.' }, { status: 404 });

  let patch;
  if (body.void) {
    patch = { voided_at: new Date().toISOString(), void_reason: String(body.reason || '').trim().slice(0, 300) };
  } else {
    const s = new Date(body.started_at); const e = new Date(body.ended_at);
    if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime())) return NextResponse.json({ error: 'Enter both a start and an end time.' }, { status: 400 });
    if (e <= s) return NextResponse.json({ error: 'The end time has to be after the start time.' }, { status: 400 });
    if (e - s > MAX_MS) return NextResponse.json({ error: 'One entry can be at most 24 hours. Split it into two.' }, { status: 400 });
    if (e.getTime() > Date.now() + 5 * 60 * 1000) return NextResponse.json({ error: 'The end time cannot be in the future.' }, { status: 400 });
    patch = { started_at: s.toISOString(), ended_at: e.toISOString(), edited_at: new Date().toISOString() };
  }
  const { data: updated, error } = await admin.from('job_clock_sessions').update(patch).eq('id', session.id).select('*').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (updated.ended_at) await syncLedgerEntry(admin, updated);
  return NextResponse.json({ ok: true, session: updated });
}
