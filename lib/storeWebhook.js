import { getAdmin } from '@/lib/supabaseAdmin';

// Stores a verified webhook event. Returns { duplicate: true } if already received.
export async function storeWebhookEvent({ provider, eventId, eventType, payload }) {
  const { error } = await getAdmin().from('webhook_events').insert({
    provider,
    event_id: eventId,
    event_type: eventType ?? null,
    payload,
  });
  if (error) {
    if (error.code === '23505') return { duplicate: true };
    throw error;
  }
  return { duplicate: false };
}
