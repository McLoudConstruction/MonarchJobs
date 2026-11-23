import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { siteUrl } from '@/lib/integrations';
import { previewStreetOffers, sendStreetOffers } from '@/lib/streetOffersServer';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Office and owner. { action: 'preview' } lists who would get an offer and sends nothing.
// { action: 'send', customer_ids: [...] } sends to the people left ticked: this is the approval.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const admin = getAdmin();
  try {
    if (body.action === 'send') {
      const ids = Array.isArray(body.customer_ids) ? body.customer_ids.filter((x) => typeof x === 'string' && UUID.test(x)).slice(0, 50) : [];
      if (!ids.length) return NextResponse.json({ error: 'Tick at least one person.' }, { status: 400 });
      const out = await sendStreetOffers({ admin, origin: siteUrl(request), jobId: params.id, customerIds: ids });
      if (out.sent > 0) {
        await admin.from('job_events').insert({ job_id: params.id, actor_id: auth.staff.id, actor_email: auth.staff.email, kind: 'street_offers_sent', details: { count: out.sent } });
      }
      return NextResponse.json(out);
    }
    return NextResponse.json(await previewStreetOffers(admin, params.id));
  } catch (e) {
    console.error('street offers failed:', e.message);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
