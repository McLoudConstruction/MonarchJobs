'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/useAuth';
import IntegrationPanel from '@/components/settings/IntegrationPanel';

const STRIPE_FIELDS = [
  { name: 'publishable_key', label: 'Publishable key', placeholder: 'pk_live_... or pk_test_...' },
  { name: 'secret_key', label: 'Secret key', secret: true, placeholder: 'sk_live_... or sk_test_...' },
  { name: 'webhook_secret', label: 'Webhook signing secret', secret: true, placeholder: 'whsec_...' },
];

const SQUARE_FIELDS = [
  { name: 'access_token', label: 'Access token', secret: true },
  { name: 'location_id', label: 'Location ID' },
  { name: 'webhook_signature_key', label: 'Webhook signature key', secret: true },
  { name: 'environment', label: 'Environment', options: ['production', 'sandbox'] },
];

export default function IntegrationsSection({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/integrations/credentials', token);
      setData(r.integrations);
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="msg err">{error}</div>;
  if (!data) return <p>Loading integrations...</p>;

  return (
    <>
      <IntegrationPanel
        provider="stripe"
        title="Stripe"
        status={data.stripe}
        fields={STRIPE_FIELDS}
        token={token}
        onChanged={load}
        help="Used for card payments taken on site. Add a webhook endpoint in the Stripe dashboard (Developers, Webhooks) with the URL below, then paste its signing secret here."
      />
      <IntegrationPanel
        provider="square"
        title="Square"
        status={data.square}
        fields={SQUARE_FIELDS}
        token={token}
        onChanged={load}
        help="Used for payment links, which work well with tips. Add a webhook subscription in the Square Developer dashboard with the URL below, then paste its signature key here."
      />
    </>
  );
}
