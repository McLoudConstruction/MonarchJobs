import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { canReopen } from '@/lib/invoice';
import { UUID, dbErrorResponse, businessSettings } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';

// Opens a finished job again for a return visit. Owner, or office when the owner allows it in Settings. The invoice
// is then handled when the job is finished again: an unpaid one is voided and billed again in full, a paid one gets
// a second invoice for only the difference.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  const settings = await businessSettings();
  if (!canReopen(auth.staff.role, settings.office_can_void)) return NextResponse.json({ error: 'Only the owner can reopen a finished job.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const { error } = await getAdmin().rpc('reopen_job', { p_job: params.id, p_reason: String(body.reason || ''), p_actor: auth.staff.id });
  if (error) { const r = dbErrorResponse(error); return NextResponse.json(r.body, { status: r.status }); }
  return NextResponse.json({ ok: true });
}
