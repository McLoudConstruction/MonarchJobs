import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMoneyToCents, centsToText, daysBetween, isPastDue, daysPastDue, defaultInterestMonths, interestCents, interestBase,
  agingBucket, agingTotals, invoiceChip, invoiceLineCents, invoiceTotals, canVoid, interestWarning, buildInvoiceMessages,
  interpretStripeEvent, interpretSquareEvent,
} from '../lib/invoice.js';
import { stripeCheckoutParams, squareLinkBody, squareBase } from '../lib/paymentProcessors.js';

const inv = (o) => ({ status: 'sent', balance_cents: 10000, due_date: '2026-11-01', total_cents: 10000, credit_cents: 0, paid_cents: 0, ...o });

test('money entry turns into whole cents or null', () => {
  assert.equal(parseMoneyToCents('125'), 12500);
  assert.equal(parseMoneyToCents('$1,250.50'), 125050);
  assert.equal(parseMoneyToCents('0.1'), 10);
  assert.equal(parseMoneyToCents('12.345'), null);
  assert.equal(parseMoneyToCents(''), null);
  assert.equal(parseMoneyToCents('abc'), null);
  assert.equal(parseMoneyToCents('-5'), null);
  assert.equal(centsToText(-1234567), '-$12,345.67');
});

test('past due only applies to open invoices with a balance after the due date', () => {
  assert.equal(isPastDue(inv({}), '2026-11-16'), true);
  assert.equal(isPastDue(inv({}), '2026-11-01'), false); // due today is not late
  assert.equal(isPastDue(inv({ status: 'paid', balance_cents: 0 }), '2026-11-16'), false);
  assert.equal(isPastDue(inv({ status: 'void' }), '2026-11-16'), false);
  assert.equal(isPastDue(inv({ status: 'draft', due_date: null }), '2026-11-16'), false);
  assert.equal(isPastDue(inv({ status: 'partial', balance_cents: 500 }), '2026-11-16'), true);
  assert.equal(daysPastDue(inv({}), '2026-11-16'), 15);
  assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1);
});

test('interest: simple, per month, on the unpaid amount, rounded to the cent', () => {
  assert.equal(interestCents(6000, 1.5, 2), 180);
  assert.equal(interestCents(10001, 1.5, 1), 150); // 150.015
  assert.equal(interestCents(0, 1.5, 1), 0);
  assert.equal(interestCents(6000, 0, 1), 0);
  assert.equal(interestBase({ total_cents: 31000, credit_cents: 25000, paid_cents: 0 }), 6000);
  assert.equal(interestBase({ total_cents: 100, credit_cents: 0, paid_cents: 500 }), 0);
  assert.equal(defaultInterestMonths(inv({ due_date: '2026-09-01' }), '2026-11-16'), 2);
  assert.equal(defaultInterestMonths(inv({}), '2026-11-16'), 1);
  assert.equal(defaultInterestMonths(inv({ due_date: '2026-12-01' }), '2026-11-16'), 0);
});

test('aging groups what is owed by how late it is', () => {
  const rows = [
    inv({ due_date: '2026-12-01', balance_cents: 100 }),
    inv({ due_date: '2026-11-10', balance_cents: 200 }),
    inv({ due_date: '2026-10-01', balance_cents: 400 }),
    inv({ due_date: '2026-08-01', balance_cents: 800 }),
    inv({ status: 'paid', balance_cents: 0 }),
    inv({ status: 'draft', balance_cents: 9999 }),
    inv({ status: 'void', balance_cents: 9999 }),
  ];
  assert.deepEqual(agingTotals(rows, '2026-11-16'), { current: 100, d1_30: 200, d31_60: 400, d61: 800, total: 1500 });
  assert.equal(agingBucket(inv({ due_date: '2026-10-17' }), '2026-11-16'), 'd1_30');
  assert.equal(agingBucket(inv({ due_date: '2026-10-16' }), '2026-11-16'), 'd31_60');
});

test('the chip shows past due before sent', () => {
  assert.equal(invoiceChip(inv({}), '2026-11-02').label, 'Past due 1 day');
  assert.equal(invoiceChip(inv({}), '2026-11-02').tone, 'bad');
  assert.equal(invoiceChip(inv({ due_date: '2027-01-01' }), '2026-11-02').label, 'Sent');
  assert.equal(invoiceChip(inv({ status: 'partial', due_date: '2027-01-01' }), '2026-11-02').label, 'Part paid');
  assert.equal(invoiceChip({ status: 'paid' }).tone, 'good');
});

test('invoice totals match the database: minimum tops up, credit and payments come off', () => {
  assert.equal(invoiceLineCents({ quantity: 1.5, unit_price: 19.99 }), 2999);
  const t = invoiceTotals([{ quantity: 1, unit_price: 80 }], 120);
  assert.deepEqual(t, { subtotalCents: 8000, minimumAdjustmentCents: 4000, totalCents: 12000, balanceCents: 12000 });
  assert.equal(invoiceTotals([{ quantity: 1, unit_price: 310 }], 0, 25000).balanceCents, 6000);
  assert.equal(invoiceTotals([{ quantity: 1, unit_price: 310 }], 0, 25000, 180, 1000).balanceCents, 5180);
  assert.equal(invoiceTotals([], 120).totalCents, 0);
});

test('who may void or reopen, and when interest needs a second look', () => {
  assert.equal(canVoid('owner', false), true);
  assert.equal(canVoid('office', false), false);
  assert.equal(canVoid('office', true), true);
  assert.equal(canVoid('tech', true), false);
  assert.ok(interestWarning('residential', true));
  assert.equal(interestWarning('commercial', true), '');
  assert.equal(interestWarning('residential', false), '');
});

test('the invoice text and email carry a link, the amount and no staff names', () => {
  const m = buildInvoiceMessages({ business: 'Acme Floors', customerName: 'Ada Lovelace', link: 'https://x.test/i/abc', amountCents: 25000, dueDate: 'Nov 30, 2026', number: 1042 });
  assert.match(m.sms, /Hi Ada/);
  assert.match(m.sms, /\$250\.00/);
  assert.match(m.sms, /https:\/\/x\.test\/i\/abc/);
  assert.match(m.subject, /#1042/);
  const late = buildInvoiceMessages({ business: 'Acme', customerName: 'Ada', link: 'L', amountCents: 100, number: 7, pastDue: true });
  assert.match(late.sms, /past due/);
  assert.match(late.subject, /past due/);
  const evil = buildInvoiceMessages({ business: '<b>x</b>', customerName: 'A', link: 'L', amountCents: 1, number: 1 });
  assert.ok(!evil.html.includes('<b>x</b>'));
});

test('Stripe events become plain actions', () => {
  const paid = { type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 6000, payment_intent: 'pi_1', metadata: { invoice_id: 'inv-1' } } } };
  assert.deepEqual(interpretStripeEvent(paid), { kind: 'payment', invoiceId: 'inv-1', amountCents: 6000, tipCents: 0, ref: 'pi_1', sessionRef: 'cs_1', method: 'stripe' });
  assert.equal(interpretStripeEvent({ ...paid, data: { object: { ...paid.data.object, payment_status: 'unpaid' } } }).kind, 'ignore');
  assert.equal(interpretStripeEvent({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid' } } }).kind, 'ignore'); // not ours
  assert.equal(interpretStripeEvent({ type: 'payment_intent.payment_failed', data: { object: { metadata: { invoice_id: 'inv-1' }, last_payment_error: { message: 'Card declined' } } } }).reason, 'Card declined');
  assert.deepEqual(interpretStripeEvent({ type: 'refund.created', data: { object: { id: 're_1', status: 'succeeded', amount: 1000, payment_intent: 'pi_1' } } }), { kind: 'refund', paymentRef: 'pi_1', ref: 're_1', amountCents: 1000, method: 'stripe' });
  assert.equal(interpretStripeEvent({ type: 'refund.created', data: { object: { id: 're_1', status: 'pending', amount: 1, payment_intent: 'pi_1' } } }).kind, 'ignore');
  assert.equal(interpretStripeEvent({ type: 'charge.dispute.created', data: { object: { payment_intent: 'pi_1', amount: 6000, reason: 'fraudulent' } } }).kind, 'dispute');
  assert.equal(interpretStripeEvent({ type: 'customer.created', data: { object: {} } }).kind, 'ignore');
});

test('Square events become plain actions, with the tip kept apart', () => {
  const done = { type: 'payment.updated', data: { object: { payment: { id: 'sq_1', status: 'COMPLETED', order_id: 'ord_1', amount_money: { amount: 6000 }, tip_money: { amount: 500 } } } } };
  assert.deepEqual(interpretSquareEvent(done), { kind: 'payment', orderRef: 'ord_1', amountCents: 6000, tipCents: 500, ref: 'sq_1', method: 'square' });
  const approved = { ...done, data: { object: { payment: { ...done.data.object.payment, status: 'APPROVED' } } } };
  assert.equal(interpretSquareEvent(approved).kind, 'ignore'); // not final yet
  assert.equal(interpretSquareEvent({ ...done, data: { object: { payment: { ...done.data.object.payment, status: 'FAILED' } } } }).kind, 'payment_failed');
  assert.equal(interpretSquareEvent({ type: 'payment.updated', data: { object: { payment: { id: 'x', status: 'COMPLETED' } } } }).kind, 'ignore'); // no order
  assert.deepEqual(interpretSquareEvent({ type: 'refund.updated', data: { object: { refund: { id: 'r1', status: 'COMPLETED', payment_id: 'sq_1', amount_money: { amount: 1000 } } } } }), { kind: 'refund', paymentRef: 'sq_1', ref: 'r1', amountCents: 1000, method: 'square' });
  assert.equal(interpretSquareEvent({ type: 'dispute.created', data: { object: { dispute: { disputed_payment: { payment_id: 'sq_1' }, amount_money: { amount: 6000 } } } } }).kind, 'dispute');
});

test('the requests sent to Stripe and Square carry the invoice and the right amount', () => {
  const s = stripeCheckoutParams({ invoiceId: 'inv-1', number: 1042, businessName: 'Acme', amountCents: 6000, email: 'a@x.com', successUrl: 'https://x/ok', cancelUrl: 'https://x/no' });
  assert.equal(s.get('line_items[0][price_data][unit_amount]'), '6000');
  assert.equal(s.get('metadata[invoice_id]'), 'inv-1');
  assert.equal(s.get('payment_intent_data[metadata][invoice_id]'), 'inv-1');
  assert.equal(s.get('customer_email'), 'a@x.com');
  assert.equal(stripeCheckoutParams({ invoiceId: 'i', number: 1, amountCents: 1, successUrl: 'a', cancelUrl: 'b' }).has('customer_email'), false);
  const q = squareLinkBody({ invoiceId: 'inv-1', number: 1042, businessName: 'Acme', amountCents: 6000, redirectUrl: 'https://x/ok', locationId: 'L1', key: 'k' });
  assert.equal(q.quick_pay.price_money.amount, 6000);
  assert.equal(q.quick_pay.location_id, 'L1');
  assert.equal(q.checkout_options.allow_tipping, true);
  assert.equal(squareBase({ environment: 'sandbox' }), 'https://connect.squareupsandbox.com');
  assert.equal(squareBase({ environment: 'production' }), 'https://connect.squareup.com');
});
