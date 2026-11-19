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

const ANTHROPIC_FIELDS = [
  { name: 'api_key', label: 'API key', secret: true, placeholder: 'sk-ant-...' },
  { name: 'model', label: 'Model (optional, leave blank for the default)', placeholder: 'claude-sonnet-5-5' },
];

const OPENAI_FIELDS = [
  { name: 'api_key', label: 'API key', secret: true, placeholder: 'sk-...' },
  { name: 'model', label: 'Model (optional, leave blank for the default)', placeholder: 'gpt-5.6-terra' },
  { name: 'use_first', label: 'Use ChatGPT first when both are connected', options: ['no', 'yes'] },
];

export default function IntegrationsSection({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [scans, setScans] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/integrations/credentials', token);
      setData(r.integrations);
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiFetch('/api/ai/usage', token).then((r) => setScans(r.scansThisMonth)).catch(() => {}); }, [token, data]);

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
        provider="twilio"
        title="Twilio (text messages)"
        status={data.twilio}
        fields={TWILIO_FIELDS}
        token={token}
        onChanged={load}
        plainBadge
        help="Sends the estimate link by text. The texting number must be a Twilio number registered for business messaging (US carriers require this before texts are delivered)."
      />
      {scans != null && <p className="hint" style={{ margin: '4px 2px' }}>AI scans this month: {scans}.</p>}
      <IntegrationPanel
        provider="anthropic"
        title="Claude (AI scanning)"
        status={data.anthropic}
        fields={ANTHROPIC_FIELDS}
        token={token}
        onChanged={load}
        plainBadge
        help="Reads receipts from a photo so nobody has to type them in. Paste an API key from the Anthropic Console (console.anthropic.com, API keys); it works as soon as it is saved. The scan fills in the purchase form and a person checks it before saving. Each scan costs a few cents on your Anthropic account."
      />
      <IntegrationPanel
        provider="openai"
        title="ChatGPT / OpenAI (AI scanning)"
        status={data.openai}
        fields={OPENAI_FIELDS}
        token={token}
        onChanged={load}
        plainBadge
        help="The same receipt scanning with an OpenAI key (platform.openai.com, API keys). Connect one or both: with both, Claude is tried first (or ChatGPT, if you set it above), and the other is the backup if the first one is down or out of credit."
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
