import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID, dbErrorResponse, cancelPayLinks } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';

// Waives (removes) interest that was added. Owner only. The row stays, marked waived.
export async function DELETE(request, { params }) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id) || !UUID.test(params.interestId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const { error } = await getAdmin().rpc('invoice_waive_interest', { p_interest: params.interestId, p_actor: auth.staff.id });
  if (error) { const r = dbErrorResponse(error); return NextResponse.json(r.body, { status: r.status }); }
  await cancelPayLinks(params.id);
  return NextResponse.json({ ok: true });
}
