import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID } from '@/lib/invoiceServer';
import { validateEdit } from '@/lib/jobClock';

export const dynamic = 'force-dynamic';

// A tech asks to change the start or end of one of their own finished time entries. Nothing changes until the owner approves
// (POST /api/clock/edit-requests/[id]). Body: { session_id, started_at, ended_at, reason }.
export async function POST(request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => ({}));
  if (!UUID.test(String(body.session_id || ''))) return NextResponse.json({ error: 'That time entry was not found.' }, { status: 404 });
  const admin = getAdmin();
  const { data: session } = await admin.from('job_clock_sessions').select('*').eq('id', body.session_id).maybeSingle();
  if (!session || (auth.staff.role === 'tech' && session.staff_id !== auth.staff.id)) return NextResponse.json({ error: 'That time entry was not found.' }, { status: 404 });
  const checked = validateEdit({ session, started_at: body.started_at, ended_at: body.ended_at, reason: body.reason });
  if (checked.error) return NextResponse.json({ error: checked.error }, { status: 400 });
  const v = checked.value;
  const { data, error } = await admin.from('job_time_edit_requests').insert({
    session_id: session.id, job_id: session.job_id, requested_by: auth.staff.id,
    old_started_at: session.started_at, old_ended_at: session.ended_at, new_started_at: v.started_at, new_ended_at: v.ended_at, reason: v.reason,
  }).select('*').maybeSingle();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return NextResponse.json({ error: 'There is already a change waiting for the owner on this entry.' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, request: data });
}
