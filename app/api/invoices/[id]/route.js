import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID, dbErrorResponse } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';

// Edits the details of a draft invoice (the lines and pictures are edited directly). A sent invoice cannot be changed.
export async function PATCH(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const patch = {};
  if (typeof body.scope_note === 'string') patch.scope_note = body.scope_note.slice(0, 4000);
  if (typeof body.po_number === 'string') patch.po_number = body.po_number.trim().slice(0, 60);
  if (typeof body.bill_to_name === 'string') patch.bill_to_name = body.bill_to_name.trim().slice(0, 120);
  if (typeof body.bill_to_email === 'string') patch.bill_to_email = body.bill_to_email.trim().slice(0, 160);
  if (typeof body.bill_to_phone === 'string') patch.bill_to_phone = body.bill_to_phone.trim().slice(0, 40);
  if (body.terms_days !== undefined) {
    const d = Math.round(Number(body.terms_days));
    if (!(d >= 0 && d <= 120)) return NextResponse.json({ error: 'Payment terms must be 0 to 120 days.' }, { status: 400 });
    patch.terms_days = d;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  const { data, error } = await getAdmin().from('invoices').update(patch).eq('id', params.id).is('issued_at', null).is('voided_at', null).select('id').maybeSingle();
  if (error) { const r = dbErrorResponse(error); return NextResponse.json(r.body, { status: r.status }); }
  if (!data) return NextResponse.json({ error: 'A sent invoice cannot be edited.' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
