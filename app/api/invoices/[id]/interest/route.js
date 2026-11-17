import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID, dbErrorResponse, cancelPayLinks } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';

// Adds late interest to a past-due invoice at the rate the owner chooses. Owner only. Never automatic.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const rate = Number(body.rate);
  const months = Math.round(Number(body.months));
  const { data, error } = await getAdmin().rpc('invoice_apply_interest', { p_invoice: params.id, p_rate: rate, p_months: months, p_note: String(body.note || ''), p_actor: auth.staff.id });
  if (error) { const r = dbErrorResponse(error); return NextResponse.json(r.body, { status: r.status }); }
  await cancelPayLinks(params.id); // the balance changed
  return NextResponse.json({ ok: true, amount_cents: data });
}
