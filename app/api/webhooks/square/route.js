import { NextResponse } from 'next/server';
import { getCredentials, siteUrl, PROVIDERS } from '@/lib/integrations';
import { verifySquareSignature } from '@/lib/webhookSignatures';
import { storeWebhookEvent } from '@/lib/storeWebhook';

export const dynamic = 'force-dynamic';

// Square signs the exact notification URL + body. The URL must match what is registered in Square.
export async function POST(request) {
  const raw = await request.text();
  const creds = await getCredentials('square');
  if (!creds) return NextResponse.json({ error: 'Square is not configured.' }, { status: 503 });

  const url = siteUrl(request) + PROVIDERS.square.webhookPath;
  const ok = verifySquareSignature(raw, request.headers.get('x-square-hmacsha256-signature'), creds.webhook_signature_key, url);
  if (!ok) return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  try {
    const res = await storeWebhookEvent({
      provider: 'square',
      eventId: event.event_id,
      eventType: event.type,
      payload: event,
    });
    return NextResponse.json({ received: true, duplicate: res.duplicate });
  } catch (e) {
    console.error('square webhook store failed', e);
    return NextResponse.json({ error: 'Could not store event.' }, { status: 500 });
  }
}
