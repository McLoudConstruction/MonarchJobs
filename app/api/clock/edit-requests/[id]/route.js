import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID } from '@/lib/invoiceServer';
import { syncLedgerEntry } from '@/lib/clockServer';

export const dynamic = 'force-dynamic';

// The owner approves or turns down a time change. Body: { decision: 'approve' | 'reject', note? }.
// Approving changes the entry's times and its costing hours; the original times stay on the request as the trail.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (!['approve', 'reject'].includes(body.decision)) return NextResponse.json({ error: 'Choose approve or reject.' }, { status: 400 });
  const admin = getAdmin();
  const { data: req } = await admin.from('job_time_edit_requests').select('*').eq('id', params.id).maybeSingle();
  if (!req) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
  if (req.status !== 'pending') return NextResponse.json({ error: 'This request was already decided.' }, { status: 409 });

  if (body.decision === 'approve') {
    const { data: session } = await admin.from('job_clock_sessions').select('*').eq('id', req.session_id).maybeSingle();
    if (!session || session.voided_at || !session.ended_at) return NextResponse.json({ error: 'That time entry is no longer there to change.' }, { status: 409 });
    if (new Date(session.started_at).getTime() !== new Date(req.old_started_at).getTime() || new Date(session.ended_at).getTime() !== new Date(req.old_ended_at).getTime()) {
      return NextResponse.json({ error: 'The entry was changed since this was requested. Turn it down and ask for a new one.' }, { status: 409 });
    }
    const { data: updated, error } = await admin.from('job_clock_sessions').update({ started_at: req.new_started_at, ended_at: req.new_ended_at, edited_at: new Date().toISOString() }).eq('id', session.id).select('*').maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await syncLedgerEntry(admin, updated);
  }

  const { data: done, error: e2 } = await admin.from('job_time_edit_requests').update({
    status: body.decision === 'approve' ? 'approved' : 'rejected', decided_by: auth.staff.id, decided_at: new Date().toISOString(), decision_note: String(body.note || '').trim().slice(0, 300),
  }).eq('id', req.id).eq('status', 'pending').select('*').maybeSingle();
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  if (!done) return NextResponse.json({ error: 'This request was already decided.' }, { status: 409 });
  return NextResponse.json({ ok: true, request: done });
}
