import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID, dbErrorResponse, cancelPayLinks } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';

// Makes the invoice for a job from its estimate, or returns the one already waiting. After a return visit it follows
// the return-visit rules (unpaid invoice: voided and billed again in full; paid invoice: only the difference).
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  const admin = getAdmin();

  const { data: before } = await admin.from('invoices').select('id,status').eq('job_id', params.id).is('voided_at', null).is('superseded_by', null);
  const { data: id, error } = await admin.rpc('create_job_invoice', { p_job: params.id, p_actor: auth.staff.id, p_auto: false });
  if (error) { const r = dbErrorResponse(error); return NextResponse.json(r.body, { status: r.status }); }

  // an unpaid invoice that was replaced: its card and payment links are cancelled too
  for (const old of (before || []).filter((b) => b.id !== id)) await cancelPayLinks(old.id);
  return NextResponse.json({ ok: true, id });
}
