// AI scanning: pure pieces. What to ask, how to send it to Claude or ChatGPT, how to read the answer, and how to turn it into
// something a form can use. No network and no keys in here (see lib/aiServer.js), so the tests can check every rule.
//
// Nothing the AI returns is saved by itself: it fills a form, a person checks it, then saves.

export const RECEIPT_CATEGORIES = ['materials', 'equipment_rental', 'disposal', 'fuel', 'subcontract', 'other'];

// The models used. One line to change when a provider retires a model. The owner can also type a model name in the key panel
// (Settings > Integrations), which wins over these.
export const DEFAULT_MODELS = { anthropic: 'claude-sonnet-5-5', openai: 'gpt-5.6-terra' };

const nullableString = (description) => ({ type: ['string', 'null'], description });

// What to read off a receipt. Every field is required (a missing value is null) so ChatGPT's strict mode accepts the schema.
export const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'vendor', 'date', 'total', 'description', 'category', 'line_items', 'notes'],
  properties: {
    readable: { type: 'boolean', description: 'false when the picture is not a receipt or too blurry to read the total' },
    vendor: nullableString('Store or company name as printed, for example "Home Depot"'),
    date: nullableString('Purchase date as YYYY-MM-DD; null if not printed'),
    total: { type: ['number', 'null'], description: 'Grand total paid, in dollars, tax included; null if not printed' },
    description: { type: 'string', description: 'Short plain summary of what was bought, under 100 characters, for example "Carpet cleaning chemical, 2 gal; hose fittings"' },
    category: { type: 'string', enum: RECEIPT_CATEGORIES, description: 'materials = supplies and parts; equipment_rental; disposal = dump or disposal fees; fuel; subcontract = paid work by another company; other' },
    line_items: {
      type: 'array',
      description: 'Each purchased line, at most 25',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'amount'],
        properties: { description: { type: 'string' }, amount: { type: ['number', 'null'], description: 'Line price in dollars' } },
      },
    },
    notes: { type: 'string', description: 'Anything unclear or hard to read, in one short sentence; empty if nothing' },
  },
};

export const AI_KINDS = {
  receipt: {
    label: 'receipt',
    toolName: 'record_receipt',
    schema: RECEIPT_SCHEMA,
    prompt: 'This is a photo of a purchase receipt for a floor care and restoration company. Read it and record what it says. '
      + 'Copy the vendor, date and the grand total exactly as printed; never guess a value that is not on the paper, use null instead. '
      + 'Amounts are in US dollars. If this is not a receipt, or the total cannot be read, set readable to false.',
    normalize: (raw, opts) => normalizeReceipt(raw, opts),
  },
};

// ------------------------------------------------------------------------------------------------------ reading the answer
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const isoDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : '';
};
const toCents = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : Number(v);
  return v == null || v === '' || !Number.isFinite(n) ? null : Math.round(n * 100);
};

// Turns the AI's answer into form values: { vendor, date, description, category, amountCents, lines, readable, warnings }.
// `today` is YYYY-MM-DD (the shop's today). Anything doubtful becomes a warning the person sees next to the form, not a silent fix.
export function normalizeReceipt(raw, { today = '' } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const warnings = [];
  const readable = r.readable !== false;
  const lines = (Array.isArray(r.line_items) ? r.line_items : []).slice(0, 25)
    .map((l) => ({ description: clip(l?.description, 120), amountCents: toCents(l?.amount) }))
    .filter((l) => l.description || l.amountCents != null);
  let amountCents = toCents(r.total);
  if (amountCents != null && (amountCents < 0 || amountCents > 100000000)) { amountCents = null; warnings.push('The total looked wrong, so it was left blank. Type it in.'); }
  if (amountCents == null) warnings.push(readable ? 'No total was found on the receipt. Type the amount in.' : 'The picture could not be read as a receipt. Try again with the whole receipt flat and in good light.');

  let date = isoDate(r.date);
  if (r.date && !date) warnings.push('The date could not be read. Check it.');
  if (date && today) {
    const days = (new Date(`${date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000;
    if (days > 1) { warnings.push('The date is in the future, so it was left as today. Check it.'); date = ''; }
    else if (days < -400) warnings.push('The date is more than a year old. Check it.');
  }

  const sum = lines.every((l) => l.amountCents != null) && lines.length > 0 ? lines.reduce((s, l) => s + l.amountCents, 0) : null;
  // a receipt's lines are before tax, so the lines are normally a bit under the total; only warn when they are more than the total or far under it
  if (sum != null && amountCents != null && (sum > amountCents + 50 || amountCents - sum > Math.max(500, amountCents * 0.25))) {
    warnings.push('The line items do not add up to the total. Check the amount.');
  }
  const category = RECEIPT_CATEGORIES.includes(r.category) ? r.category : 'other';
  const description = clip(r.description, 300) || clip(lines.slice(0, 3).map((l) => l.description).filter(Boolean).join('; '), 300);
  const note = clip(r.notes, 200);
  if (note) warnings.push(note);
  return { readable, vendor: clip(r.vendor, 120), date, description, category, amountCents, lines, warnings };
}

// ------------------------------------------------------------------------------------------------------ the pictures
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_IMAGE_BASE64 = 5_500_000; // about 4 MB of picture, under both providers' limits and the website's request limit
export function checkImage({ mediaType, data }) {
  if (!IMAGE_TYPES.includes(mediaType)) return 'Send a JPEG, PNG, WebP or GIF picture.';
  if (typeof data !== 'string' || data.length < 100 || !/^[A-Za-z0-9+/]+=*$/.test(data.slice(0, 4000))) return 'The picture did not come through. Try again.';
  if (data.length > MAX_IMAGE_BASE64) return 'That picture is too large. Take it again a little farther away or choose a smaller one.';
  return null;
}

// ------------------------------------------------------------------------------------------------------ talking to the providers
export function anthropicRequest({ model, kind, mediaType, data }) {
  const k = AI_KINDS[kind];
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: {
      model: model || DEFAULT_MODELS.anthropic,
      max_tokens: 2000,
      tools: [{ name: k.toolName, description: `Record what the ${k.label} says.`, input_schema: k.schema }],
      tool_choice: { type: 'tool', name: k.toolName },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: k.prompt },
      ] }],
    },
  };
}
export function parseAnthropic(json) {
  const block = (json?.content || []).find((b) => b?.type === 'tool_use');
  if (block?.input && typeof block.input === 'object') return { ok: true, value: block.input };
  return { ok: false, error: 'Claude did not return the receipt details.' };
}

export function openaiRequest({ model, kind, mediaType, data }) {
  const k = AI_KINDS[kind];
  return {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { 'content-type': 'application/json' },
    body: {
      model: model || DEFAULT_MODELS.openai,
      max_completion_tokens: 4000,
      messages: [{ role: 'user', content: [
        { type: 'text', text: k.prompt },
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } },
      ] }],
      response_format: { type: 'json_schema', json_schema: { name: k.toolName, strict: true, schema: k.schema } },
    },
  };
}
export function parseOpenAI(json) {
  const msg = json?.choices?.[0]?.message;
  if (msg?.refusal) return { ok: false, error: 'ChatGPT declined to read that picture.' };
  try {
    const value = JSON.parse(msg?.content || '');
    if (value && typeof value === 'object') return { ok: true, value };
  } catch { /* fall through */ }
  return { ok: false, error: 'ChatGPT did not return the receipt details.' };
}

// Which provider goes first. Claude, unless the owner chose ChatGPT first on its key panel; the other one is the fallback.
export function providerOrder({ anthropic = false, openai = false, openaiFirst = false } = {}) {
  const order = [];
  if (anthropic) order.push('anthropic');
  if (openai) order.push('openai');
  if (openaiFirst && order.length === 2) order.reverse();
  return order;
}

// Plain-language reasons for the common failures, so the person knows whether it is the key, the credit or the picture.
export function providerError(provider, status, body) {
  const who = provider === 'anthropic' ? 'Claude' : 'ChatGPT';
  const text = String(body?.error?.message || body?.message || '').slice(0, 200);
  if (status === 401 || status === 403) return `${who} rejected the saved key. Paste it again in Settings > Integrations.`;
  if (status === 429) return /quota|credit|billing|balance/i.test(text) ? `${who} says the account is out of credit. Add credit in the ${who} account.` : `${who} is busy or the rate limit was hit. Wait a minute and try again.`;
  if (status === 400 && /credit|billing|balance/i.test(text)) return `${who} says the account is out of credit. Add credit in the ${who} account.`;
  if (status === 400 || status === 404) return `${who} could not use that request${text ? ` (${text})` : ''}. If you set a model name in its key panel, check it is spelled right.`;
  if (status >= 500) return `${who} is having trouble right now. Try again in a minute.`;
  return `${who} returned an error${status ? ` (${status})` : ''}.`;
}
