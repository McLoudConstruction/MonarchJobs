import { NextResponse } from 'next/server';
import { getCredentials } from '@/lib/integrations';
import { verifyStripeSignature } from '@/lib/webhookSignatures';
import { storeWebhookEvent } from '@/lib/storeWebhook';

export const dynamic = 'force-dynamic';

// Stripe sends events here. Configure the endpoint in Stripe with the URL shown in
// Settings > Integrations. The signing secret is read from the database, not env vars.
export async function POST(request) {
  const raw = await request.text();
  const creds = await getCredentials('stripe');
  if (!creds) return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });

  const ok = verifyStripeSignature(raw, request.headers.get('stripe-signature'), creds.webhook_secret);
  if (!ok) return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  try {
    const res = await storeWebhookEvent({
      provider: 'stripe',
      eventId: event.id,
      eventType: event.type,
      payload: event,
    });
    // Processing (marking invoices paid, etc.) is added in Phase 1.
    return NextResponse.json({ received: true, duplicate: res.duplicate });
  } catch (e) {
    console.error('stripe webhook store failed', e);
    return NextResponse.json({ error: 'Could not store event.' }, { status: 500 });
  }
}
