import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { siteUrl } from '@/lib/integrations';
import { UUID, getPayLink, onlineProviders, businessSettings } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';

// The customer taps Pay on their invoice page. Square first (it offers a tip), Stripe when only that is set up.
// Returns the payment page to send them to.
export async function POST(request, { params }) {
  if (!UUID.test(params.token)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const { data: inv } = await getAdmin().from('invoices').select('*').eq('share_token', params.token).maybeSingle();
  if (!inv || inv.status === 'draft') return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (inv.status === 'void') return NextResponse.json({ error: 'This invoice is no longer payable. Please contact us.' }, { status: 409 });
  if (inv.balance_cents <= 0) return NextResponse.json({ error: 'This invoice is already paid.' }, { status: 409 });
  const providers = await onlineProviders();
  const provider = providers.square ? 'square' : providers.stripe ? 'stripe' : null;
  if (!provider) return NextResponse.json({ error: 'Online payment is not available. Please contact us to pay.' }, { status: 409 });
  const settings = await businessSettings();
  try {
    const link = await getPayLink({ invoice: inv, provider, businessName: settings.business_name, siteBase: siteUrl(request), userId: null });
    return NextResponse.json({ url: link.url });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
