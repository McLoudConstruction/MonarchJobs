import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID, dbErrorResponse } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';

// Rebuilds a draft invoice from the current estimate (the lines were changed after the draft was made).
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const { error } = await getAdmin().rpc('invoice_refresh_from_estimate', { p_invoice: params.id });
  if (error) { const r = dbErrorResponse(error); return NextResponse.json(r.body, { status: r.status }); }
  return NextResponse.json({ ok: true });
}
