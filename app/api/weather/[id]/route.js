import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { siteUrl } from '@/lib/integrations';
import { previewStorm, sendStorm } from '@/lib/weatherServer';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Office and owner. { action: 'preview' } shows the capacity check and who would be messaged, and sends nothing.
// { action: 'send', customer_ids: [...] } sends to the people left ticked: this is the approval.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  const alertId = Number(params.id);
  if (!Number.isInteger(alertId) || alertId < 1) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const admin = getAdmin();
  try {
    if (body.action === 'send') {
      const ids = Array.isArray(body.customer_ids) ? body.customer_ids.filter((x) => typeof x === 'string' && UUID.test(x)).slice(0, 100) : [];
      if (!ids.length) return NextResponse.json({ error: 'Tick at least one person.' }, { status: 400 });
      const out = await sendStorm({ admin, origin: siteUrl(request), alertId, customerIds: ids, staffId: auth.staff.id });
      if (out.error) return NextResponse.json({ error: out.error }, { status: out.status || 400 });
      return NextResponse.json(out);
    }
    const out = await previewStorm(admin, alertId);
    if (out.error) return NextResponse.json({ error: out.error }, { status: out.status || 400 });
    return NextResponse.json(out);
  } catch (e) {
    console.error('storm alert failed:', e.message);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
