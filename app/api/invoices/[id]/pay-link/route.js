import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { siteUrl } from '@/lib/integrations';
import { sendSms, sendEmail } from '@/lib/notify';
import { buildInvoiceMessages } from '@/lib/invoice';
import { UUID, loadInvoice, businessSettings, getPayLink, invoiceVisibleTo, onlineProviders } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';

// Starts an online payment for the invoice's balance.
//   provider "stripe": card on site ("Pay now"). The tech or office opens the returned url and hands the phone over.
//   provider "square": link with a tip. With deliver: true the link page is texted and emailed to the customer.
// A technician may only do this on a job they are scheduled on, and only the card on site; they cannot send links.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office', 'tech']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const provider = body.provider === 'square' ? 'square' : 'stripe';
  const isOffice = auth.staff.role !== 'tech';
  if (!isOffice && (provider !== 'stripe' || body.deliver)) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  if (!isOffice && !(await invoiceVisibleTo(request, params.id))) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });

  const inv = await loadInvoice(params.id);
  if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const providers = await onlineProviders();
  if (!providers[provider]) return NextResponse.json({ error: `${provider === 'stripe' ? 'Card payments (Stripe)' : 'Square'} is not set up in Settings > Integrations.` }, { status: 409 });

  const settings = await businessSettings();
  const base = siteUrl(request);
  try {
    // a draft handed over on site is sent in person first, so it is no longer editable
    if (inv.status === 'draft') {
      const { error } = await getAdmin().rpc('invoice_issue', { p_invoice: inv.id, p_via: 'in_person', p_actor: auth.staff.id });
      if (error) throw new Error(error.message.replace(/^[A-Z_]+:\s*/, ''));
    }
    const fresh = await loadInvoice(params.id);
    const link = await getPayLink({ invoice: fresh, provider, businessName: settings.business_name, siteBase: base, userId: auth.staff.id });

    let delivery = null;
    if (body.deliver) {
      const page = `${base}/i/${fresh.share_token}`;
      const msgs = buildInvoiceMessages({ business: settings.business_name, customerName: fresh.bill_to_name, link: page, amountCents: fresh.balance_cents, dueDate: '', number: fresh.invoice_number });
      const [sms, email] = await Promise.all([
        fresh.bill_to_phone ? sendSms({ to: fresh.bill_to_phone, body: msgs.sms }) : { status: 'skipped', detail: 'No phone number on file.' },
        fresh.bill_to_email ? sendEmail({ to: fresh.bill_to_email, subject: msgs.subject, html: msgs.html, text: msgs.text }) : { status: 'skipped', detail: 'No email on file.' },
      ]);
      delivery = { sms, email, delivered: sms.status === 'sent' || email.status === 'sent' };
    }
    return NextResponse.json({ ok: true, url: link.url, provider, tip: link.tip, page: `${base}/i/${fresh.share_token}`, delivery });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
