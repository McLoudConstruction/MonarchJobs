import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { parseMoneyToCents } from '@/lib/invoice';
import { UUID, dbErrorResponse, loadInvoice, cancelPayLinks } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';

// Records a cash, check or other payment taken in person. Office and owner. A draft invoice is sent in person first.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const method = ['cash', 'check', 'other'].includes(body.method) ? body.method : null;
  if (!method) return NextResponse.json({ error: 'Choose cash, check or other.' }, { status: 400 });
  const amount = parseMoneyToCents(body.amount);
  if (!amount) return NextResponse.json({ error: 'Enter the amount received.' }, { status: 400 });

  const inv = await loadInvoice(params.id);
  if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  if (inv.status === 'void') return NextResponse.json({ error: 'This invoice was voided.' }, { status: 409 });
  if (inv.status === 'paid') return NextResponse.json({ error: 'This invoice is already paid in full.' }, { status: 409 });
  if (amount > inv.balance_cents && !body.confirm_over) {
    return NextResponse.json({ error: 'That is more than the balance. Confirm if the customer is overpaying.', code: 'OVER_BALANCE', balance_cents: inv.balance_cents }, { status: 409 });
  }
  const { data: id, error } = await getAdmin().rpc('record_payment', {
    p_invoice: params.id, p_method: method, p_amount: amount, p_tip: 0, p_processor_ref: null,
    p_reference: String(body.reference || '').slice(0, 80), p_note: String(body.note || '').slice(0, 500), p_actor: auth.staff.id,
  });
  if (error) { const r = dbErrorResponse(error); return NextResponse.json(r.body, { status: r.status }); }
  await cancelPayLinks(params.id); // the balance changed
  return NextResponse.json({ ok: true, id });
}
