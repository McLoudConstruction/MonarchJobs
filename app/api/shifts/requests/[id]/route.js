import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';
const same = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

// The owner approves or turns down a shift clock change. Body: { decision: 'approve' | 'reject', note? }.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (!['approve', 'reject'].includes(body.decision)) return NextResponse.json({ error: 'Choose approve or reject.' }, { status: 400 });
  const admin = getAdmin();
  const { data: req } = await admin.from('shift_edit_requests').select('*').eq('id', params.id).maybeSingle();
  if (!req) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
  if (req.status !== 'pending') return NextResponse.json({ error: 'This request was already decided.' }, { status: 409 });
  const now = new Date().toISOString();

  if (body.decision === 'approve') {
    if (req.target === 'add') {
      const { data: clash } = await admin.from('shifts').select('id').eq('staff_id', req.requested_by).is('voided_at', null).lt('started_at', req.new_ended_at).or(`ended_at.is.null,ended_at.gt.${req.new_started_at}`).limit(1);
      if (clash?.length) return NextResponse.json({ error: 'That time now overlaps another shift. Turn it down and ask for a new one.' }, { status: 409 });
      const { error } = await admin.from('shifts').insert({ staff_id: req.requested_by, started_at: req.new_started_at, ended_at: req.new_ended_at, source: 'approved', edited_at: now });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (req.target === 'shift') {
      const { data: s } = await admin.from('shifts').select('*').eq('id', req.shift_id).maybeSingle();
      if (!s || s.voided_at || !s.ended_at) return NextResponse.json({ error: 'That shift is no longer there to change.' }, { status: 409 });
      if (!same(s.started_at, req.old_started_at) || !same(s.ended_at, req.old_ended_at)) return NextResponse.json({ error: 'The shift was changed since this was requested. Turn it down and ask for a new one.' }, { status: 409 });
      const { error } = await admin.from('shifts').update({ started_at: req.new_started_at, ended_at: req.new_ended_at, edited_at: now, source: 'approved' }).eq('id', s.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { data: k } = await admin.from('shift_breaks').select('*').eq('id', req.break_id).maybeSingle();
      if (!k || k.voided_at || !k.ended_at) return NextResponse.json({ error: 'That break is no longer there to change.' }, { status: 409 });
      if (!same(k.started_at, req.old_started_at) || !same(k.ended_at, req.old_ended_at)) return NextResponse.json({ error: 'The break was changed since this was requested. Turn it down and ask for a new one.' }, { status: 409 });
      const { error } = await admin.from('shift_breaks').update({ started_at: req.new_started_at, ended_at: req.new_ended_at, edited_at: now }).eq('id', k.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  const { data: done, error: e2 } = await admin.from('shift_edit_requests').update({
    status: body.decision === 'approve' ? 'approved' : 'rejected', decided_by: auth.staff.id, decided_at: now, decision_note: String(body.note || '').trim().slice(0, 300),
  }).eq('id', req.id).eq('status', 'pending').select('*').maybeSingle();
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  if (!done) return NextResponse.json({ error: 'This request was already decided.' }, { status: 409 });
  return NextResponse.json({ ok: true, request: done });
}
