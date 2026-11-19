import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID } from '@/lib/invoiceServer';
import { validateShiftEdit } from '@/lib/shiftClock';

export const dynamic = 'force-dynamic';

// Ask to change a shift or a break, or to add a missed shift. Nothing changes until the owner approves.
// Body: { target: 'shift'|'break'|'add', shift_id?, break_id?, started_at, ended_at, reason }.
export async function POST(request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  const b = await request.json().catch(() => ({}));
  const admin = getAdmin();
  const me = auth.staff.id;
  const target = b.target;
  let shift = null; let brk = null;
  if (target === 'shift' || target === 'break') {
    let id = b.shift_id;
    if (target === 'break') {
      if (!UUID.test(String(b.break_id || ''))) return NextResponse.json({ error: 'That break was not found.' }, { status: 404 });
      const { data } = await admin.from('shift_breaks').select('*').eq('id', b.break_id).maybeSingle();
      if (!data || data.staff_id !== me) return NextResponse.json({ error: 'That break was not found.' }, { status: 404 });
      brk = data; id = data.shift_id;
    }
    if (!UUID.test(String(id || ''))) return NextResponse.json({ error: 'That shift was not found.' }, { status: 404 });
    const { data } = await admin.from('shifts').select('*').eq('id', id).maybeSingle();
    if (!data || data.staff_id !== me) return NextResponse.json({ error: 'That shift was not found.' }, { status: 404 });
    shift = data;
  }
  const [{ data: breaks }, { data: others }] = await Promise.all([
    shift ? admin.from('shift_breaks').select('*').eq('shift_id', shift.id) : { data: [] },
    admin.from('shifts').select('*').eq('staff_id', me).is('voided_at', null),
  ]);
  const checked = validateShiftEdit({ target, shift, brk, breaks: breaks || [], others: others || [], started_at: b.started_at, ended_at: b.ended_at, reason: b.reason });
  if (checked.error) return NextResponse.json({ error: checked.error }, { status: 400 });
  const v = checked.value;
  const { data, error } = await admin.from('shift_edit_requests').insert({
    requested_by: me, target, shift_id: shift?.id || null, break_id: brk?.id || null,
    old_started_at: (brk || shift)?.started_at || null, old_ended_at: (brk || shift)?.ended_at || null,
    new_started_at: v.started_at, new_ended_at: v.ended_at, reason: v.reason,
  }).select('*').maybeSingle();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return NextResponse.json({ error: 'There is already a change waiting for the owner on this.' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, request: data });
}
