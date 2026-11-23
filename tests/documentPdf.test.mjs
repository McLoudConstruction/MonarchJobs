import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInvoicePdf, renderEstimatePdf, invoiceFileName, estimateFileName } from '../lib/documentPdf.js';

const head = (b) => Buffer.from(b.slice(0, 5)).toString('latin1');
const info = { business: 'Monarch Cleaning & Restoration', phone: '(913) 555-0100', email: 'info@example.com', customer: 'Test Customer', address: '10901 East 62 Terrace, Raytown, MO 64133', jobNumber: 1008, jobType: 'Carpet' };
const lines = [
  { id: 'a', description: 'Carpet cleaning', unit: 'sqft', quantity: 850, unit_price: 0.3, sort_order: 1 },
  { id: 'b', description: 'Pet odor treatment', unit: 'room', quantity: 2, unit_price: 25, sort_order: 2 },
];

test('an invoice PDF is made, with payments and many lines across pages', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ description: `Line ${i + 1} with a longer description to wrap across the column width of the table`, unit: 'flat', quantity: 1, unit_price: 10 }));
  const inv = { invoice_number: 3, status: 'partial', issued_at: '2026-11-20T15:00:00Z', due_date: '2026-12-05', subtotal_cents: 80000, total_cents: 80000, paid_cents: 30000, balance_cents: 50000, lines: many, payments: [{ received_at: '2026-11-21T15:00:00Z', method: 'cash', amount_cents: 30000 }] };
  const pdf = renderInvoicePdf({ info, invoice: inv });
  assert.equal(head(pdf), '%PDF-');
  assert.ok(pdf.length > 2000);
  assert.equal(invoiceFileName(info, inv), 'invoice-3-job-1008.pdf');
});

test('an estimate PDF is made for a draft with options, and for an approved one', () => {
  const tiered = [...lines, { id: 'c', description: 'Protector', unit: 'sqft', quantity: 850, unit_price: 0.1, tier: 'better' }, { id: 'd', description: 'Deodorizer', unit: 'flat', quantity: 1, unit_price: 40, optional: true }];
  assert.equal(head(renderEstimatePdf({ info, estimate: { status: 'draft', minimum_charge: 100 }, lines: tiered })), '%PDF-');
  const approved = renderEstimatePdf({ info, estimate: { status: 'approved', minimum_charge: 100, chosen_tier: 'better' }, lines: tiered, signature: { signer_name: 'Pat', signed_at: '2026-11-21T15:00:00Z' } });
  assert.equal(head(approved), '%PDF-');
  assert.equal(estimateFileName(info), 'estimate-job-1008.pdf');
  assert.equal(estimateFileName({ customer: 'Test Customer' }), 'estimate-test-customer.pdf');
});
