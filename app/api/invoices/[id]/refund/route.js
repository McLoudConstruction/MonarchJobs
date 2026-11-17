import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { parseMoneyToCents } from '@/lib/invoice';
import { UUID, dbErrorResponse, cancelPayLinks } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';

// Records a refund that was handed back in cash or by check (owner only). Card refunds are made in Stripe or Square and
// come back here by themselves.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const amount = parseMoneyToCents(body.amount);
  if (!amount) return NextResponse.json({ error: 'Enter the amount refunded.' }, { status: 400 });
  const admin = getAdmin();
  const { data: pays } = await admin.from('payments').select('id,method,amount_cents').eq('invoice_id', params.id).in('method', ['cash', 'check', 'other']).gt('amount_cents', 0).order('received_at', { ascending: false });
  const paid = (pays || []).reduce((s, p) => s + p.amount_cents, 0);
  const { data: refunded } = await admin.from('payments').select('amount_cents').eq('invoice_id', params.id).in('method', ['cash', 'check', 'other']).lt('amount_cents', 0);
  const room = paid + (refunded || []).reduce((s, p) => s + p.amount_cents, 0);
  if (!pays?.length || amount > room) return NextResponse.json({ error: 'That is more than was paid by cash or check. Refund card payments in Stripe or Square.' }, { status: 400 });
  const { error } = await admin.rpc('record_payment', {
    p_invoice: params.id, p_method: pays[0].method, p_amount: -amount, p_tip: 0, p_processor_ref: null,
    p_reference: '', p_note: String(body.note || '').slice(0, 500), p_actor: auth.staff.id, p_received: null, p_refund_of: pays[0].id,
  });
  if (error) { const r = dbErrorResponse(error); return NextResponse.json(r.body, { status: r.status }); }
  await cancelPayLinks(params.id);
  return NextResponse.json({ ok: true });
}
