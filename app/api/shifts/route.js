import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID } from '@/lib/invoiceServer';
import { shiftAction } from '@/lib/shiftServer';
import { validateShiftEdit } from '@/lib/shiftClock';

export const dynamic = 'force-dynamic';

// Shift clock buttons for the signed-in person. Body: { action: 'in' | 'out' | 'break_start' | 'break_end' }.
// Owner only: { action: 'add', staff_id, started_at, ended_at, reason } adds a shift directly.
export async function POST(request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => ({}));
  const admin = getAdmin();
  if (body.action === 'add') {
    if (auth.staff.role !== 'owner') return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
    if (!UUID.test(String(body.staff_id || ''))) return NextResponse.json({ error: 'Pick a person.' }, { status: 400 });
    const { data: others } = await admin.from('shifts').select('*').eq('staff_id', body.staff_id).is('voided_at', null);
    const checked = validateShiftEdit({ target: 'add', others: others || [], started_at: body.started_at, ended_at: body.ended_at, reason: body.reason || 'Added by the owner' }, new Date(Date.now() + 1000 * 3600 * 24 * 365));
    if (checked.error) return NextResponse.json({ error: checked.error }, { status: 400 });
    if (new Date(checked.value.ended_at) > new Date()) return NextResponse.json({ error: 'The end time cannot be in the future.' }, { status: 400 });
    const { data, error } = await admin.from('shifts').insert({ staff_id: body.staff_id, started_at: checked.value.started_at, ended_at: checked.value.ended_at, source: 'office', edited_at: new Date().toISOString() }).select('*').maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, shift: data });
  }
  const r = await shiftAction(admin, auth.staff.id, body.action);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
  return NextResponse.json(r);
}
