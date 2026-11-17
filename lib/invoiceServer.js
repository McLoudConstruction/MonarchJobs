import { createClient } from '@supabase/supabase-js';
import { getAdmin } from '@/lib/supabaseAdmin';
import { getCredentials } from '@/lib/integrations';
import { createStripeCheckout, expireStripeCheckout, createSquareLink, deleteSquareLink } from '@/lib/paymentProcessors';
import { interpretStripeEvent, interpretSquareEvent, centsToText } from '@/lib/invoice';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The database functions raise messages like "NOTHING_TO_BILL: the job total is not more than ...".
// Turns that into a status and a sentence for the screen.
export function dbErrorResponse(error) {
  const msg = String(error?.message || error || '');
  const m = msg.match(/^([A-Z_]+):\s*(.*)$/s);
  if (!m) {
    console.error('invoice db error', msg);
    return { status: 500, body: { error: 'Something went wrong saving that. Try again.' } };
  }
  const code = m[1];
  const text = m[2] || msg;
  const status = { INVOICE_NOT_FOUND: 404, JOB_NOT_FOUND: 404, INVOICE_LOCKED: 409, INVOICE_VOID: 409, HAS_PAYMENTS: 409, NOT_FINISHED: 409, NOT_OPEN: 409, NOT_PAST_DUE: 409, NOTHING_TO_BILL: 409 }[code] || 400;
  const friendly = {
    INVOICE_NOT_FOUND: 'Invoice not found.',
    JOB_NOT_FOUND: 'Job not found.',
    NOTHING_TO_BILL: 'There is nothing new to bill: the job total is not more than what the customer already paid.',
  }[code];
  return { status, body: { error: friendly || text.replace(/^./, (c) => c.toUpperCase()), code } };
}

// Cancels the card and payment links that are still open (voided, paid in person, or the amount changed).
export async function cancelPayLinks(invoiceId, { except } = {}) {
  const admin = getAdmin();
  const { data: links } = await admin.from('invoice_pay_links').select('id,provider,ref').eq('invoice_id', invoiceId).is('cancelled_at', null).is('completed_at', null);
  for (const l of links || []) {
    if (except && l.id === except) continue;
    const creds = await getCredentials(l.provider);
    if (creds) {
      if (l.provider === 'stripe') await expireStripeCheckout(creds, l.ref);
      else await deleteSquareLink(creds, l.ref);
    }
    await admin.from('invoice_pay_links').update({ cancelled_at: new Date().toISOString() }).eq('id', l.id);
  }
}

// Which online payment options are set up (Square first because it offers a tip).
export async function onlineProviders() {
  const [square, stripe] = await Promise.all([getCredentials('square'), getCredentials('stripe')]);
  return { square: !!square, stripe: !!stripe };
}

// One pay link per invoice and amount: reused while it is still good, replaced when the balance moved.
// Returns { url, provider, tip } or throws an Error with a sentence for the screen.
export async function getPayLink({ invoice, provider, businessName, siteBase, userId }) {
  const admin = getAdmin();
  if (invoice.status === 'void') throw new Error('This invoice was voided.');
  if (invoice.status === 'draft') throw new Error('Send the invoice first.');
  if (invoice.balance_cents <= 0) throw new Error('This invoice is already paid.');
  const creds = await getCredentials(provider);
  if (!creds) throw new Error(`${provider === 'stripe' ? 'Stripe' : 'Square'} is not set up in Settings > Integrations.`);

  const { data: existing } = await admin.from('invoice_pay_links').select('id,url,amount_cents').eq('invoice_id', invoice.id).eq('provider', provider).is('cancelled_at', null).is('completed_at', null).order('created_at', { ascending: false });
  const good = (existing || []).find((l) => Number(l.amount_cents) === Number(invoice.balance_cents));
  if (good) return { url: good.url, provider, tip: provider === 'square' };
  await cancelPayLinks(invoice.id, {}); // old amounts

  const back = `${siteBase}/i/${invoice.share_token}`;
  const args = { invoiceId: invoice.id, number: invoice.invoice_number, businessName, amountCents: Number(invoice.balance_cents), email: invoice.bill_to_email || undefined };
  let made;
  try {
    made = provider === 'stripe'
      ? await createStripeCheckout(creds, { ...args, successUrl: `${back}?paid=1`, cancelUrl: back })
      : await createSquareLink(creds, { ...args, redirectUrl: `${back}?paid=1` });
  } catch (e) {
    throw new Error(`Could not start the payment: ${e.message}`);
  }
  if (!made?.url) throw new Error('The payment company did not return a payment link.');
  await admin.from('invoice_pay_links').insert({ invoice_id: invoice.id, provider, ref: made.ref, order_ref: made.orderRef || null, url: made.url, amount_cents: Number(invoice.balance_cents), created_by: userId || null });
  return { url: made.url, provider, tip: provider === 'square' };
}

// ----------------------------------------------------------------------- webhooks
async function findPayment(method, ref) {
  const { data } = await getAdmin().from('payments').select('id,invoice_id').eq('method', method).eq('processor_ref', ref).maybeSingle();
  return data || null;
}

// Applies one already-verified, already-stored event. Returns a short note for the log. Throws only for errors worth a retry.
export async function applyPaymentAction(a) {
  const admin = getAdmin();
  if (!a || a.kind === 'ignore') return 'ignored';

  if (a.kind === 'payment' || a.kind === 'payment_failed') {
    let invoiceId = a.invoiceId || null;
    let link = null;
    if (!invoiceId && a.orderRef) {
      const { data } = await admin.from('invoice_pay_links').select('id,invoice_id').eq('order_ref', a.orderRef).maybeSingle();
      if (!data) return 'no invoice for that order';
      invoiceId = data.invoice_id; link = data;
    }
    if (!invoiceId) return 'no invoice';
    if (a.kind === 'payment_failed') {
      const { error } = await admin.rpc('invoice_money_alert', { p_invoice: invoiceId, p_title: 'Payment failed', p_body: a.reason || 'A payment did not go through.', p_dispute: false });
      if (error) throw error;
      return 'failure alerted';
    }
    const { data: id, error } = await admin.rpc('record_payment', { p_invoice: invoiceId, p_method: a.method, p_amount: a.amountCents, p_tip: a.tipCents || 0, p_processor_ref: a.ref });
    if (error) throw error;
    if (!link && a.sessionRef) {
      const { data } = await admin.from('invoice_pay_links').select('id').eq('ref', a.sessionRef).maybeSingle();
      link = data;
    }
    if (link) await admin.from('invoice_pay_links').update({ completed_at: new Date().toISOString() }).eq('id', link.id);
    await cancelPayLinks(invoiceId, { except: link?.id }); // balance changed, the other links are stale
    return id ? 'payment recorded' : 'duplicate payment ignored';
  }

  if (a.kind === 'refund') {
    const pay = await findPayment(a.method, a.paymentRef);
    if (!pay) return 'refund for a payment we do not have';
    const { data: id, error } = await admin.rpc('record_payment', {
      p_invoice: pay.invoice_id, p_method: a.method, p_amount: -Math.abs(a.amountCents), p_tip: 0, p_processor_ref: a.ref,
      p_reference: '', p_note: `Refunded in ${a.method === 'stripe' ? 'Stripe' : 'Square'}`, p_actor: null, p_received: null, p_refund_of: pay.id,
    });
    if (error) throw error;
    return id ? 'refund recorded' : 'duplicate refund ignored';
  }

  if (a.kind === 'dispute') {
    const pay = await findPayment(a.method, a.paymentRef);
    if (!pay) return 'dispute for a payment we do not have';
    const { error } = await admin.rpc('invoice_money_alert', {
      p_invoice: pay.invoice_id, p_title: 'Payment disputed',
      p_body: `The customer disputed ${centsToText(a.amountCents)} with their card company${a.reason ? ` (${a.reason})` : ''}. Respond in ${a.method === 'stripe' ? 'Stripe' : 'Square'}.`,
      p_dispute: true,
    });
    if (error) throw error;
    return 'dispute alerted';
  }
  return 'ignored';
}

export async function markWebhook(provider, eventId, { note, error }) {
  await getAdmin().from('webhook_events').update({ processed_at: error ? null : new Date().toISOString(), error: error ? String(error).slice(0, 500) : null }).eq('provider', provider).eq('event_id', eventId);
}

export async function wasProcessed(provider, eventId) {
  const { data } = await getAdmin().from('webhook_events').select('processed_at').eq('provider', provider).eq('event_id', eventId).maybeSingle();
  return !!data?.processed_at;
}

// Used by both webhook routes after the event is verified and stored.
export async function processWebhook(provider, event, eventId) {
  if (await wasProcessed(provider, eventId)) return { note: 'already processed' };
  const action = provider === 'stripe' ? interpretStripeEvent(event) : interpretSquareEvent(event);
  try {
    const note = await applyPaymentAction(action);
    await markWebhook(provider, eventId, { note });
    return { note };
  } catch (e) {
    await markWebhook(provider, eventId, { error: e.message });
    throw e;
  }
}

// ----------------------------------------------------------------------- shared route helpers

// Reads as the signed-in person, so a technician only gets an invoice on a job they are scheduled on.
export async function invoiceVisibleTo(request, invoiceId) {
  const token = (request.headers.get('authorization') || '').slice(7);
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data } = await client.from('invoices').select('id').eq('id', invoiceId).maybeSingle();
  return !!data;
}

export async function loadInvoice(invoiceId) {
  const { data } = await getAdmin().from('invoices').select('*').eq('id', invoiceId).maybeSingle();
  return data || null;
}

export async function businessSettings() {
  const { data } = await getAdmin().from('settings').select('business_name,office_can_void,late_interest_rate,late_interest_commercial_only,invoice_footer').eq('id', 1).maybeSingle();
  return data || {};
}

export async function jobEvent(row) {
  await getAdmin().from('job_events').insert(row);
}
