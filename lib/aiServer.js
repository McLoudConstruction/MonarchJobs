// Server only. Sends a picture to Claude or ChatGPT with the owner's own key (saved in Settings > Integrations) and returns the
// details read from it. Nothing is stored except a log line per scan (who, what kind, which provider, worked or not).
import { getAdmin } from './supabaseAdmin.js';
import { getCredentials } from './integrations.js';
import { AI_KINDS, anthropicRequest, parseAnthropic, openaiRequest, parseOpenAI, providerOrder, providerError, checkImage } from './aiExtract.js';

const TIMEOUT_MS = 50_000;

async function callProvider(provider, { kind, mediaType, data }, creds) {
  const req = provider === 'anthropic' ? anthropicRequest({ model: creds.model, kind, mediaType, data }) : openaiRequest({ model: creds.model, kind, mediaType, data });
  const headers = { ...req.headers, ...(provider === 'anthropic' ? { 'x-api-key': creds.api_key } : { Authorization: `Bearer ${creds.api_key}` }) };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(req.url, { method: 'POST', headers, body: JSON.stringify(req.body), signal: ctl.signal });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: providerError(provider, res.status, json) };
    return provider === 'anthropic' ? parseAnthropic(json) : parseOpenAI(json);
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'The scan took too long. Try again.' : `Could not reach ${provider === 'anthropic' ? 'Claude' : 'ChatGPT'}.` };
  } finally { clearTimeout(timer); }
}

// Which providers are connected, in the order they will be tried.
export async function connectedProviders() {
  const [a, o] = await Promise.all([getCredentials('anthropic'), getCredentials('openai')]);
  const creds = { anthropic: a, openai: o };
  const order = providerOrder({ anthropic: !!a, openai: !!o, openaiFirst: o?.use_first === 'yes' });
  return { creds, order };
}

// Runs one scan. Returns { ok: true, provider, raw } or { ok: false, status, error }. The caller turns `raw` into form values.
export async function scanPicture({ kind, mediaType, data, staffId }) {
  if (!AI_KINDS[kind]) return { ok: false, status: 400, error: 'Unknown kind of scan.' };
  const bad = checkImage({ mediaType, data });
  if (bad) return { ok: false, status: 400, error: bad };
  const { creds, order } = await connectedProviders();
  if (!order.length) return { ok: false, status: 409, error: 'Scanning is not set up. The owner can add a Claude or ChatGPT key in Settings > Integrations.' };
  const admin = getAdmin();
  const errors = [];
  for (const provider of order) {
    const r = await callProvider(provider, { kind, mediaType, data }, creds[provider]);
    await admin.from('ai_scan_log').insert({ staff_id: staffId || null, kind, provider, ok: !!r.ok, error: r.ok ? '' : String(r.error || '').slice(0, 300) }).then(() => {}, () => {});
    if (r.ok) return { ok: true, provider, raw: r.value };
    errors.push(r.error);
  }
  return { ok: false, status: 502, error: errors.length > 1 ? `${errors[0]} The backup also failed: ${errors[1]}` : errors[0] };
}

// Scans this month, for the owner's key panel.
export async function monthlyScanCount(now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { count } = await getAdmin().from('ai_scan_log').select('id', { count: 'exact', head: true }).gte('created_at', from);
  return count || 0;
}
