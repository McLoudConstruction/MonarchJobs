import { getAdmin } from '@/lib/supabaseAdmin';
import { encryptJson, decryptJson } from '@/lib/crypto';

// Definition of what each provider needs. "secret" fields are encrypted and never returned
// to the browser (only the last 4 characters). "public" fields are stored as plain metadata.
export const PROVIDERS = {
  stripe: {
    label: 'Stripe',
    secret: ['secret_key', 'webhook_secret'],
    public: ['publishable_key'],
    required: ['secret_key', 'publishable_key', 'webhook_secret'],
    webhookPath: '/api/webhooks/stripe',
  },
  square: {
    label: 'Square',
    secret: ['access_token', 'webhook_signature_key'],
    public: ['location_id', 'environment'],
    required: ['access_token', 'location_id', 'webhook_signature_key'],
    webhookPath: '/api/webhooks/square',
  },
  twilio: {
    label: 'Twilio (text messages)',
    secret: ['auth_token'],
    public: ['account_sid', 'from_number'],
    required: ['account_sid', 'auth_token', 'from_number'],
  },
  resend: {
    label: 'Resend (email)',
    secret: ['api_key'],
    public: ['from_email', 'from_name'],
    required: ['api_key', 'from_email'],
  },
};

export function siteUrl(request) {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/$/, '');
  return new URL(request.url).origin;
}

function last4(v) {
  return v ? String(v).slice(-4) : '';
}

function deriveMode(provider, values) {
  if (provider === 'stripe') {
    const k = values.secret_key || '';
    if (k.startsWith('sk_live_') || k.startsWith('rk_live_')) return 'live';
    if (k.startsWith('sk_test_') || k.startsWith('rk_test_')) return 'test';
    return 'unknown';
  }
  if (provider === 'square') return values.environment === 'sandbox' ? 'test' : 'live';
  return 'live';
}

// Status for the Settings page. Never includes secret values.
export async function getStatuses() {
  const { data, error } = await getAdmin().from('integration_credentials').select('*');
  if (error) throw error;
  const out = {};
  for (const [provider, def] of Object.entries(PROVIDERS)) {
    const row = data.find((r) => r.provider === provider);
    const meta = row?.public_meta || {};
    const configured = !!row && def.required.every((f) => meta.present?.[f]);
    out[provider] = {
      label: def.label,
      configured,
      mode: configured ? meta.mode : null,
      public: Object.fromEntries(def.public.map((f) => [f, meta.public?.[f] ?? ''])),
      secretLast4: Object.fromEntries(def.secret.map((f) => [f, meta.last4?.[f] ?? ''])),
      present: meta.present || {},
      updatedAt: row?.updated_at ?? null,
    };
  }
  return out;
}

// Full credentials for server-side use (payments, webhooks). Null when not configured.
export async function getCredentials(provider) {
  const def = PROVIDERS[provider];
  if (!def) return null;
  const { data } = await getAdmin()
    .from('integration_credentials')
    .select('public_meta,secrets_enc')
    .eq('provider', provider)
    .maybeSingle();
  if (!data?.secrets_enc) return null;
  const secrets = decryptJson(data.secrets_enc);
  const values = { ...(data.public_meta?.public || {}), ...secrets };
  if (!def.required.every((f) => values[f])) return null;
  return values;
}

// Saves submitted values. A blank field keeps the existing stored value.
export async function saveCredentials(provider, submitted, userId) {
  const def = PROVIDERS[provider];
  if (!def) throw new Error('Unknown provider.');
  const admin = getAdmin();

  const { data: existing } = await admin
    .from('integration_credentials')
    .select('public_meta,secrets_enc')
    .eq('provider', provider)
    .maybeSingle();

  const secrets = existing?.secrets_enc ? decryptJson(existing.secrets_enc) : {};
  const pub = { ...(existing?.public_meta?.public || {}) };

  for (const f of def.secret) {
    const v = (submitted[f] ?? '').toString().trim();
    if (v) secrets[f] = v;
  }
  for (const f of def.public) {
    const v = (submitted[f] ?? '').toString().trim();
    if (v) pub[f] = v;
  }
  if (provider === 'square' && !pub.environment) pub.environment = 'production';
  if (provider === 'square' && !['sandbox', 'production'].includes(pub.environment)) {
    throw new Error('Environment must be sandbox or production.');
  }

  const all = { ...pub, ...secrets };
  const meta = {
    public: pub,
    last4: Object.fromEntries(def.secret.filter((f) => secrets[f]).map((f) => [f, last4(secrets[f])])),
    present: Object.fromEntries(def.required.map((f) => [f, !!all[f]])),
    mode: deriveMode(provider, all),
  };

  const { error } = await admin.from('integration_credentials').upsert({
    provider,
    public_meta: meta,
    secrets_enc: encryptJson(secrets),
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });
  if (error) throw error;
  return meta;
}

export async function removeCredentials(provider) {
  const { error } = await getAdmin().from('integration_credentials').delete().eq('provider', provider);
  if (error) throw error;
}

// Live connection checks against each provider's API.
export async function testConnection(provider) {
  const creds = await getCredentials(provider);
  if (!creds) return { ok: false, message: 'Not fully configured. Fill in every field and save first.' };

  try {
    if (provider === 'stripe') {
      const res = await fetch('https://api.stripe.com/v1/account', {
        headers: { Authorization: `Bearer ${creds.secret_key}` },
      });
      const body = await res.json();
      if (!res.ok) return { ok: false, message: body?.error?.message || `Stripe returned ${res.status}.` };
      return { ok: true, message: `Connected to Stripe account ${body.id}.` };
    }
    if (provider === 'twilio') {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.account_sid)}.json`, {
        headers: { Authorization: `Basic ${Buffer.from(`${creds.account_sid}:${creds.auth_token}`).toString('base64')}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body?.message || `Twilio returned ${res.status}.` };
      return { ok: true, message: `Connected to Twilio account ${body.friendly_name || creds.account_sid}. Texts will be sent from ${creds.from_number}.` };
    }
    if (provider === 'resend') {
      const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${creds.api_key}` } });
      const body = await res.json().catch(() => ({}));
      // A "sending access" key cannot list domains but can send, which is all we need.
      if (res.status === 401 && body?.name === 'restricted_api_key') return { ok: true, message: 'Send-only key accepted. Emails will be sent from ' + creds.from_email + '.' };
      if (!res.ok) return { ok: false, message: body?.message || `Resend returned ${res.status}.` };
      const domain = (creds.from_email.split('@')[1] || '').toLowerCase();
      const match = (body.data || []).find((d) => d.name?.toLowerCase() === domain);
      if (!match) return { ok: false, message: `Key works, but ${domain} is not a domain on this Resend account. Verify it in Resend or use a different From address.` };
      if (match.status !== 'verified') return { ok: false, message: `${domain} is on Resend but not verified yet (${match.status}).` };
      return { ok: true, message: `Connected. ${domain} is verified, emails will be sent from ${creds.from_email}.` };
    }
    if (provider === 'square') {
      const base = creds.environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
      const res = await fetch(`${base}/v2/locations/${encodeURIComponent(creds.location_id)}`, {
        headers: { Authorization: `Bearer ${creds.access_token}`, 'Square-Version': '2024-10-17' },
      });
      const body = await res.json();
      if (!res.ok) return { ok: false, message: body?.errors?.[0]?.detail || `Square returned ${res.status}.` };
      return { ok: true, message: `Connected to Square location ${body.location?.name || creds.location_id}.` };
    }
  } catch (e) {
    return { ok: false, message: `Could not reach ${PROVIDERS[provider].label}: ${e.message}` };
  }
  return { ok: false, message: 'Unknown provider.' };
}
