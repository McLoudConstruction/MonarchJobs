import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeReceipt, checkImage, anthropicRequest, parseAnthropic, openaiRequest, parseOpenAI, providerOrder, providerError,
  RECEIPT_SCHEMA, RECEIPT_CATEGORIES, DEFAULT_MODELS, MAX_IMAGE_BASE64, AI_KINDS,
} from '../lib/aiExtract.js';
import { readFileSync } from 'node:fs';

const B64 = 'A'.repeat(400);

test('a clean receipt becomes form values', () => {
  const r = normalizeReceipt({
    readable: true, vendor: ' Home Depot ', date: '2026-11-16', total: 84.37, description: 'Hose fittings; duct tape', category: 'materials',
    line_items: [{ description: 'Hose fitting', amount: 40.5 }, { description: 'Duct tape', amount: 39 }], notes: '',
  }, { today: '2026-11-18' });
  assert.equal(r.vendor, 'Home Depot');
  assert.equal(r.date, '2026-11-16');
  assert.equal(r.amountCents, 8437);
  assert.equal(r.category, 'materials');
  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.warnings, []);
});

test('doubtful values become warnings, never silent fixes', () => {
  const none = normalizeReceipt({ readable: false, vendor: null, date: null, total: null, description: '', category: 'materials', line_items: [], notes: '' }, { today: '2026-11-18' });
  assert.equal(none.amountCents, null);
  assert.match(none.warnings[0], /could not be read as a receipt/);
  const future = normalizeReceipt({ readable: true, date: '2026-12-25', total: 10, description: 'x', category: 'fuel', line_items: [] }, { today: '2026-11-18' });
  assert.equal(future.date, '');
  assert.match(future.warnings.join(' '), /future/);
  const badDate = normalizeReceipt({ readable: true, date: '11/16/26', total: 10, description: 'x', category: 'fuel', line_items: [] }, { today: '2026-11-18' });
  assert.equal(badDate.date, '');
  assert.match(badDate.warnings.join(' '), /date could not be read/);
  const old = normalizeReceipt({ readable: true, date: '2024-01-02', total: 10, description: 'x', category: 'fuel', line_items: [] }, { today: '2026-11-18' });
  assert.match(old.warnings.join(' '), /more than a year/);
  const huge = normalizeReceipt({ readable: true, total: 999999999, description: 'x', category: 'fuel', line_items: [] });
  assert.equal(huge.amountCents, null);
  const notReal = normalizeReceipt({ readable: true, date: '2026-02-31', total: 5, description: 'x', category: 'fuel', line_items: [] });
  assert.equal(notReal.date, '');
});

test('lines that do not add up to the total are flagged; tax on top is fine', () => {
  const tax = normalizeReceipt({ readable: true, total: 108, description: 'x', category: 'materials', line_items: [{ description: 'a', amount: 60 }, { description: 'b', amount: 40 }] });
  assert.deepEqual(tax.warnings, []); // 100 before tax, 108 total
  const off = normalizeReceipt({ readable: true, total: 50, description: 'x', category: 'materials', line_items: [{ description: 'a', amount: 60 }, { description: 'b', amount: 40 }] });
  assert.match(off.warnings.join(' '), /do not add up/);
  const far = normalizeReceipt({ readable: true, total: 300, description: 'x', category: 'materials', line_items: [{ description: 'a', amount: 60 }] });
  assert.match(far.warnings.join(' '), /do not add up/);
});

test('category, text length and a missing summary are handled', () => {
  const r = normalizeReceipt({ readable: true, total: '$1,234.50', vendor: 'V'.repeat(300), description: '', category: 'groceries', line_items: [{ description: 'Chem 2 gal', amount: 20 }, { description: 'Hose', amount: 30 }], notes: 'Bottom of the receipt is cut off' });
  assert.equal(r.amountCents, 123450);
  assert.equal(r.vendor.length, 120);
  assert.equal(r.category, 'other');
  assert.equal(r.description, 'Chem 2 gal; Hose');
  assert.ok(r.warnings.includes('Bottom of the receipt is cut off'));
  assert.deepEqual(normalizeReceipt(null).lines, []);
});

test('the receipt schema is accepted by strict mode: every property required, nothing extra', () => {
  const walk = (o) => {
    if (o?.type === 'object' || (Array.isArray(o?.type) && o.type.includes('object'))) {
      assert.equal(o.additionalProperties, false);
      assert.deepEqual([...o.required].sort(), Object.keys(o.properties).sort());
      Object.values(o.properties).forEach(walk);
    }
    if (o?.type === 'array') walk(o.items);
  };
  walk(RECEIPT_SCHEMA);
  assert.deepEqual(RECEIPT_SCHEMA.properties.category.enum, RECEIPT_CATEGORIES);
});

test('pictures are checked before anything is sent', () => {
  assert.equal(checkImage({ mediaType: 'image/jpeg', data: B64 }), null);
  assert.match(checkImage({ mediaType: 'application/pdf', data: B64 }), /JPEG/);
  assert.match(checkImage({ mediaType: 'image/png', data: 'data:image/png;base64,abc' }), /did not come through/);
  assert.match(checkImage({ mediaType: 'image/png', data: 'A'.repeat(MAX_IMAGE_BASE64 + 1) }), /too large/);
});

test('the Claude request forces the receipt tool and carries the picture', () => {
  const q = anthropicRequest({ kind: 'receipt', mediaType: 'image/jpeg', data: B64 });
  assert.equal(q.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(q.body.model, DEFAULT_MODELS.anthropic);
  assert.deepEqual(q.body.tool_choice, { type: 'tool', name: 'record_receipt' });
  assert.equal(q.body.tools[0].input_schema, RECEIPT_SCHEMA);
  const [img, text] = q.body.messages[0].content;
  assert.deepEqual([img.type, img.source.type, img.source.media_type, img.source.data], ['image', 'base64', 'image/jpeg', B64]);
  assert.match(text.text, /receipt/);
  assert.ok(!JSON.stringify(q.headers).includes('key')); // the key is added on the server only
  assert.equal(anthropicRequest({ kind: 'receipt', mediaType: 'image/png', data: B64, model: 'my-model' }).body.model, 'my-model');
});

test('the ChatGPT request uses a strict schema and a data URL', () => {
  const q = openaiRequest({ kind: 'receipt', mediaType: 'image/png', data: B64 });
  assert.equal(q.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(q.body.model, DEFAULT_MODELS.openai);
  assert.equal(q.body.response_format.type, 'json_schema');
  assert.equal(q.body.response_format.json_schema.strict, true);
  assert.equal(q.body.messages[0].content[1].image_url.url, `data:image/png;base64,${B64}`);
});

test('answers are read from each provider’s format', () => {
  const value = { readable: true, total: 5 };
  assert.deepEqual(parseAnthropic({ content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'record_receipt', input: value }] }), { ok: true, value });
  assert.equal(parseAnthropic({ content: [{ type: 'text', text: 'sorry' }] }).ok, false);
  assert.deepEqual(parseOpenAI({ choices: [{ message: { content: JSON.stringify(value) } }] }), { ok: true, value });
  assert.equal(parseOpenAI({ choices: [{ message: { content: 'not json' } }] }).ok, false);
  assert.match(parseOpenAI({ choices: [{ message: { refusal: 'no' } }] }).error, /declined/);
});

test('Claude goes first unless ChatGPT is chosen first; the other is the backup', () => {
  assert.deepEqual(providerOrder({ anthropic: true, openai: true }), ['anthropic', 'openai']);
  assert.deepEqual(providerOrder({ anthropic: true, openai: true, openaiFirst: true }), ['openai', 'anthropic']);
  assert.deepEqual(providerOrder({ openai: true, openaiFirst: true }), ['openai']);
  assert.deepEqual(providerOrder({ anthropic: true }), ['anthropic']);
  assert.deepEqual(providerOrder({}), []);
});

test('failures say what to do', () => {
  assert.match(providerError('anthropic', 401, {}), /Claude rejected the saved key/);
  assert.match(providerError('openai', 429, { error: { message: 'You exceeded your current quota' } }), /out of credit/);
  assert.match(providerError('openai', 429, { error: { message: 'Rate limit reached' } }), /rate limit/);
  assert.match(providerError('anthropic', 400, { error: { message: 'Your credit balance is too low' } }), /out of credit/);
  assert.match(providerError('openai', 404, { error: { message: 'model not found' } }), /model name/);
  assert.match(providerError('anthropic', 529, {}), /trouble/);
});

test('the key panels exist and the scan kinds are registered', () => {
  const src = readFileSync(new URL('../lib/integrations.js', import.meta.url), 'utf8');
  assert.match(src, /anthropic: \{[^}]*required: \['api_key'\]/s);
  assert.match(src, /openai: \{[^}]*public: \['model', 'use_first'\]/s);
  assert.ok(AI_KINDS.receipt.normalize);
});
