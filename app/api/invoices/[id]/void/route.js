import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { canVoid } from '@/lib/invoice';
import { UUID, dbErrorResponse, cancelPayLinks, businessSettings } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';

// Voids an invoice that has no payments on it. The record stays (it is the audit trail) but it no longer counts, and its
// card and payment links are cancelled so it cannot be paid. Owner, or office when the owner allows it in Settings.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const settings = await businessSettings();
  if (!canVoid(auth.staff.role, settings.office_can_void)) return NextResponse.json({ error: 'Only the owner can void an invoice.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const { error } = await getAdmin().rpc('invoice_void', { p_invoice: params.id, p_reason: String(body.reason || ''), p_actor: auth.staff.id });
  if (error) { const r = dbErrorResponse(error); return NextResponse.json(r.body, { status: r.status }); }
  await cancelPayLinks(params.id);
  return NextResponse.json({ ok: true });
}
