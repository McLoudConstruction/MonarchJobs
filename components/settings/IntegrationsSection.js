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

const GOOGLE_FIELDS = [
  { name: 'api_key', label: 'API key', secret: true, placeholder: 'AIza...' },
];

const TWILIO_FIELDS = [
  { name: 'account_sid', label: 'Account SID', placeholder: 'AC...' },
  { name: 'auth_token', label: 'Auth token', secret: true },
  { name: 'from_number', label: 'Texting number', placeholder: '+18165551212' },
];

const RESEND_FIELDS = [
  { name: 'api_key', label: 'API key', secret: true, placeholder: 're_...' },
  { name: 'from_email', label: 'Send from (email address)', placeholder: 'estimates@yourdomain.com' },
  { name: 'from_name', label: 'Send from (name, optional)', placeholder: 'McLoud Floor Care' },
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
      <IntegrationPanel
        provider="google_maps"
        title="Google Maps (address suggestions)"
        status={data.google_maps}
        fields={GOOGLE_FIELDS}
        token={token}
        onChanged={load}
        plainBadge
        help="Fills in the street, city, state and ZIP as an address is typed. Use a Google Cloud key with Maps JavaScript API and Places API (New) turned on, billing enabled, and limited to this website's address. Address fields still work without it."
      />
      <IntegrationPanel
        provider="twilio"
        title="Twilio (text messages)"
        status={data.twilio}
        fields={TWILIO_FIELDS}
        token={token}
        onChanged={load}
        plainBadge
        help="Sends the estimate link by text. The texting number must be a Twilio number registered for business messaging (US carriers require this before texts are delivered)."
      />
      <IntegrationPanel
        provider="resend"
        title="Resend (email)"
        status={data.resend}
        fields={RESEND_FIELDS}
        token={token}
        onChanged={load}
        plainBadge
        help="Sends the estimate link by email. The send-from address must be on a domain verified in Resend."
      />
    </>
  );
}
