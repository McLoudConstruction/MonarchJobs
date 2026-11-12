import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// A signed-in person saves or removes this phone's push subscription.
// POST body: { endpoint, keys: { p256dh, auth }, userAgent }   DELETE body: { endpoint }
export async function POST(request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => ({}));
  const endpoint = String(body.endpoint || '');
  const p256dh = String(body.keys?.p256dh || '');
  const authKey = String(body.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000 || !p256dh || !authKey) {
    return NextResponse.json({ error: 'That is not a valid push subscription.' }, { status: 400 });
  }
  // The endpoint is unique per device. If someone else was signed in on this phone before,
  // the subscription moves to the person using it now.
  const { error } = await getAdmin().from('push_subscriptions').upsert(
    { user_id: auth.staff.id, endpoint, p256dh, auth: authKey, user_agent: String(body.userAgent || '').slice(0, 300) },
    { onConflict: 'endpoint' }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => ({}));
  const endpoint = String(body.endpoint || '');
  if (!endpoint) return NextResponse.json({ error: 'Missing endpoint.' }, { status: 400 });
  const { error } = await getAdmin().from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', auth.staff.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
