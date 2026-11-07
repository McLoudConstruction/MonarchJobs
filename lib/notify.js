import { getCredentials } from '@/lib/integrations';
import { toE164 } from '@/lib/phone';

// Twilio wants +1XXXXXXXXXX (or a messaging service id starting with MG).
const fromNumber = (v) => (/^(\+|MG)/.test(String(v).trim()) ? String(v).trim() : toE164(v) || String(v).trim());

export { buildEstimateMessages } from '@/lib/estimateMessages';

// Text and email delivery. Credentials come from Settings > Integrations (Twilio, Resend), so a
// provider that is not set up is "skipped", never an error. Server only.

export async function sendSms({ to, body }) {
  const creds = await getCredentials('twilio');
  if (!creds) return { status: 'skipped', detail: 'Text messaging is not set up in Settings.' };
  const e164 = toE164(to);
  if (!e164) return { status: 'skipped', detail: 'No valid mobile number on file.' };
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.account_sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.account_sid}:${creds.auth_token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: e164, From: fromNumber(creds.from_number), Body: body }).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { status: 'failed', detail: json.message || `Twilio returned ${res.status}.` };
    return { status: 'sent', detail: `Text sent to ${e164}.`, id: json.sid };
  } catch (e) {
    return { status: 'failed', detail: `Could not reach Twilio: ${e.message}` };
  }
}

export async function sendEmail({ to, subject, html, text }) {
  const creds = await getCredentials('resend');
  if (!creds) return { status: 'skipped', detail: 'Email is not set up in Settings.' };
  const addr = String(to || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return { status: 'skipped', detail: 'No valid email address on file.' };
  const from = creds.from_name ? `${creds.from_name} <${creds.from_email}>` : creds.from_email;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [addr], subject, html, text }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { status: 'failed', detail: json.message || `Resend returned ${res.status}.` };
    return { status: 'sent', detail: `Email sent to ${addr}.`, id: json.id };
  } catch (e) {
    return { status: 'failed', detail: `Could not reach Resend: ${e.message}` };
  }
}
