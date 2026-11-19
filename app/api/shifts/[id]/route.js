import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';

// Owner fixes a shift or break directly. Body: { break_id?, started_at?, ended_at?, void?: true }.
// With break_id the change is to that break; otherwise to the shift. Voiding a shift also voids its breaks.
export async function PATCH(request, { params }) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Shift not found.' }, { status: 404 });
  const b = await request.json().catch(() => ({}));
  const admin = getAdmin();
  const { data: shift } = await admin.from('shifts').select('*').eq('id', params.id).maybeSingle();
  if (!shift) return NextResponse.json({ error: 'Shift not found.' }, { status: 404 });
  const now = new Date().toISOString();
  const patch = {};
  if (b.void) { patch.voided_at = now; } else {
    const s = new Date(b.started_at || shift.started_at); const e = b.ended_at === null ? null : new Date(b.ended_at || shift.ended_at || '');
    if (Number.isNaN(s.getTime()) || (e && Number.isNaN(e.getTime()))) return NextResponse.json({ error: 'Enter valid times.' }, { status: 400 });
    if (e && e <= s) return NextResponse.json({ error: 'The end time has to be after the start time.' }, { status: 400 });
    if ((e && e.getTime() > Date.now() + 5 * 60000) || s.getTime() > Date.now() + 5 * 60000) return NextResponse.json({ error: 'Times cannot be in the future.' }, { status: 400 });
    patch.started_at = s.toISOString(); patch.ended_at = e ? e.toISOString() : null; patch.edited_at = now;
  }
  if (b.break_id) {
    if (!UUID.test(String(b.break_id))) return NextResponse.json({ error: 'Break not found.' }, { status: 404 });
    const { error } = await admin.from('shift_breaks').update(patch).eq('id', b.break_id).eq('shift_id', shift.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const { error } = await admin.from('shifts').update(patch).eq('id', shift.id);
  if (error) return NextResponse.json({ error: /duplicate|unique/i.test(error.message) ? 'That person already has a shift running.' : error.message }, { status: 500 });
  if (b.void) await admin.from('shift_breaks').update({ voided_at: now }).eq('shift_id', shift.id).is('voided_at', null);
  return NextResponse.json({ ok: true });
}
