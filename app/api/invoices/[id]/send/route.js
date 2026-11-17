import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { siteUrl } from '@/lib/integrations';
import { sendSms, sendEmail } from '@/lib/notify';
import { buildInvoiceMessages, isPastDue } from '@/lib/invoice';
import { UUID, dbErrorResponse, loadInvoice, businessSettings } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';

// Texts and emails the customer a link to view and pay the invoice. A draft becomes Sent only when a message actually
// went out (or when the office says it handed the invoice over another way: body { manual: true }). Sending a sent
// invoice again is a resend, or a past-due reminder when it is past due.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const admin = getAdmin();

  const inv = await loadInvoice(params.id);
  if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  if (inv.status === 'void') return NextResponse.json({ error: 'This invoice was voided.' }, { status: 409 });
  if (inv.status === 'paid') return NextResponse.json({ error: 'This invoice is already paid.' }, { status: 409 });
  if (inv.balance_cents <= 0) return NextResponse.json({ error: 'There is nothing to bill on this invoice.' }, { status: 400 });
  const { count } = await admin.from('invoice_lines').select('id', { count: 'exact', head: true }).eq('invoice_id', inv.id);
  if (!count) return NextResponse.json({ error: 'Add at least one line before sending the invoice.' }, { status: 400 });

  const link = `${siteUrl(request)}/i/${inv.share_token}`;
  if (body.manual) {
    if (inv.status === 'draft') {
      const { error } = await admin.rpc('invoice_issue', { p_invoice: inv.id, p_via: 'manual', p_actor: auth.staff.id });
      if (error) { const r = dbErrorResponse(error); return NextResponse.json(r.body, { status: r.status }); }
    }
    return NextResponse.json({ ok: true, manual: true, link });
  }

  const settings = await businessSettings();
  const wasDraft = inv.status === 'draft';
  // a draft has no due date yet: it will be today plus the terms
  const dueText = inv.due_date ? new Date(`${inv.due_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : `${inv.terms_days} days after today`;
  const msgs = buildInvoiceMessages({ business: settings.business_name, customerName: inv.bill_to_name, link, amountCents: inv.balance_cents, dueDate: wasDraft ? '' : dueText, number: inv.invoice_number, resend: !wasDraft, pastDue: isPastDue(inv) });

  const [sms, email] = await Promise.all([
    inv.bill_to_phone ? sendSms({ to: inv.bill_to_phone, body: msgs.sms }) : { status: 'skipped', detail: 'No phone number on file.' },
    inv.bill_to_email ? sendEmail({ to: inv.bill_to_email, subject: msgs.subject, html: msgs.html, text: msgs.text }) : { status: 'skipped', detail: 'No email on file.' },
  ]);
  const delivered = sms.status === 'sent' || email.status === 'sent';

  if (delivered && wasDraft) {
    const { error } = await admin.rpc('invoice_issue', { p_invoice: inv.id, p_via: 'delivered', p_actor: auth.staff.id });
    if (error) { const r = dbErrorResponse(error); return NextResponse.json(r.body, { status: r.status }); }
  }
  await admin.from('job_events').insert({
    job_id: inv.job_id, actor_id: auth.staff.id, actor_email: auth.staff.email, kind: 'invoice_delivery',
    details: { invoice_id: inv.id, invoice_number: inv.invoice_number, delivered, sms: { status: sms.status, detail: sms.detail }, email: { status: email.status, detail: email.detail } },
  });
  return NextResponse.json({ ok: delivered, results: { sms, email }, link, sms_body: msgs.sms, subject: msgs.subject, text_body: msgs.text });
}
