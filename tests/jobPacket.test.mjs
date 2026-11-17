import test from 'node:test';
import assert from 'node:assert/strict';
import { renderJobPacket, packetContents } from '../lib/jobPacket.js';

const inv = (o = {}) => ({ id: 'i1', invoice_number: 1001, status: 'paid', bill_to_name: 'Pat Smith', issued_at: '2026-11-10T15:00:00Z', due_date: '2026-11-24', subtotal_cents: 25000, minimum_adjustment_cents: 0, total_cents: 25000, paid_cents: 25000, balance_cents: 0, lines: [{ description: 'Carpet cleaning', unit: 'sqft', quantity: 500, unit_price: 0.5, sort_order: 0 }], payments: [{ method: 'check', reference: '1234', amount_cents: 25000, tip_cents: 0, received_at: '2026-11-12T15:00:00Z', recorded_by: 'staff-uuid-secret' }], ...o });
const est = { signature: { signer_name: 'Pat Smith', signed_at: '2026-11-09T15:00:00Z', total_cents: 25000, minimum_charge: 0, lines_snapshot: [{ description: 'Carpet cleaning', unit: 'sqft', quantity: 500, unit_price: 0.5 }], ip: '1.2.3.4', user_agent: 'UA-SECRET' } };
const insp = [{ id: 'p1', kind: 'pre', signer_name: 'Pat Smith', signed_at: '2026-11-10T10:00:00Z', data: { rooms: [{ id: 'r', name: 'Living room', fiber: 'Nylon', issues: [{ id: 's', where: 'by door', type: 'Pet urine' }] }] } }];

test('packet holds only sent invoices and signed documents', () => {
  const c = packetContents({ invoices: [inv(), inv({ id: 'd', status: 'draft' }), inv({ id: 'v', status: 'void' })], estimate: est, inspections: [...insp, { id: 'q', kind: 'post', data: {}, signed_at: null }] });
  assert.equal(c.invoices.length, 1);
  assert.ok(c.estimate && c.pre && !c.post);
  assert.deepEqual(c.parts, ['1 invoice', 'signed estimate', 'signed before-cleaning inspection']);
  assert.equal(packetContents({}).empty, true);
});

test('a packet renders to a PDF and leaks no staff id, IP or device', () => {
  const bytes = renderJobPacket({ info: { business: 'Monarch', customer: 'Pat Smith', address: '1 Main St', jobNumber: 77 }, invoices: [inv()], estimate: est.signature ? { ...est } : null, inspections: insp });
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-'));
  for (const s of ['Job Packet', 'Invoice #1001', 'Estimate, signed', 'Before cleaning inspection, signed', 'Carpet cleaning']) assert.ok(text.includes(s), s);
  for (const s of ['staff-uuid-secret', '1.2.3.4', 'UA-SECRET']) assert.ok(!text.includes(s), s);
});

test('an empty packet still renders a cover that says so', () => {
  const text = Buffer.from(renderJobPacket({ info: { customer: 'X' } })).toString('latin1');
  assert.ok(text.includes('Nothing has been invoiced or signed'));
});
