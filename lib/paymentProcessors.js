// Making and cancelling pay links at Stripe and Square. Server only. Keys come from Settings > Integrations.
// The request bodies are built by small pure functions so they can be tested without calling anyone.

const SQUARE_VERSION = '2024-10-17';

// ----------------------------------------------------------------------- Stripe (card on site, no tip)
export function stripeCheckoutParams({ invoiceId, number, businessName, amountCents, email, successUrl, cancelUrl }) {
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('client_reference_id', invoiceId);
  p.set('success_url', successUrl);
  p.set('cancel_url', cancelUrl);
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', 'usd');
  p.set('line_items[0][price_data][unit_amount]', String(amountCents));
  p.set('line_items[0][price_data][product_data][name]', `Invoice #${number}${businessName ? ` - ${businessName}` : ''}`);
  p.set('metadata[invoice_id]', invoiceId);
  p.set('payment_intent_data[metadata][invoice_id]', invoiceId);
  p.set('payment_intent_data[description]', `Invoice #${number}`);
  if (email) p.set('customer_email', email);
  return p;
}

async function stripeCall(creds, path, params) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.secret_key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? params.toString() : '',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe returned ${res.status}.`);
  return json;
}

export async function createStripeCheckout(creds, args) {
  const s = await stripeCall(creds, '/checkout/sessions', stripeCheckoutParams(args));
  return { ref: s.id, url: s.url };
}

export async function expireStripeCheckout(creds, ref) {
  try { await stripeCall(creds, `/checkout/sessions/${encodeURIComponent(ref)}/expire`); return true; } catch { return false; } // already paid or expired
}

// ----------------------------------------------------------------------- Square (link with tip)
export const squareBase = (creds) => (creds.environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com');

export function squareLinkBody({ invoiceId, number, businessName, amountCents, email, redirectUrl, locationId, key }) {
  const body = {
    idempotency_key: key || `${invoiceId}-${amountCents}-${Date.now()}`,
    quick_pay: {
      name: `Invoice #${number}${businessName ? ` - ${businessName}` : ''}`,
      price_money: { amount: amountCents, currency: 'USD' },
      location_id: locationId,
    },
    checkout_options: { allow_tipping: true, redirect_url: redirectUrl },
    payment_note: `Invoice #${number}`,
  };
  if (email) body.pre_populated_data = { buyer_email: email };
  return body;
}

async function squareCall(creds, method, path, body) {
  const res = await fetch(`${squareBase(creds)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${creds.access_token}`, 'Square-Version': SQUARE_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.errors?.[0]?.detail || `Square returned ${res.status}.`);
  return json;
}

export async function createSquareLink(creds, args) {
  const json = await squareCall(creds, 'POST', '/v2/online-checkout/payment-links', squareLinkBody({ ...args, locationId: creds.location_id }));
  const link = json.payment_link || {};
  return { ref: link.id, orderRef: link.order_id || null, url: link.long_url || link.url };
}

export async function deleteSquareLink(creds, ref) {
  try { await squareCall(creds, 'DELETE', `/v2/online-checkout/payment-links/${encodeURIComponent(ref)}`); return true; } catch { return false; }
}
