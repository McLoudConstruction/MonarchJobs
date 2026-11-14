import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, planOutreach, buildOutreachMessages, renderTemplate, advancePlan, dateInTz } from '../lib/outreach.js';
import { mailingRows, toCsv, MAILING_HEADER } from '../lib/mailingList.js';
import { aftercareFor, buildAftercareMessages } from '../lib/aftercare.js';
import { cleanProblem, cleanRequest } from '../lib/customerPage.js';

const settings = { rebook_enabled: true, rebook_months: [3, 6, 12, 18, 24], plan_offer_enabled: true, plan_offer_days: 75, plan_remind_days: 14, plan_remind_enabled: true };
const cust = (over = {}) => ({ id: 'c1', display_name: 'Pat Lee', first_name: 'Pat', phone: '(816) 555-0100', email: 'p@x.com', opt_out: false, has_open_work: false, last_visit_at: '2026-08-14T15:00:00Z', last_job: { id: 'j1', token: 't1', type: 'floor_cleaning' }, ...over });
const at = (d) => new Date(`${d}T16:00:00Z`);

test('dates add months without spilling into the next one', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-11-14', 3), '2027-02-14');
  assert.equal(addMonths('2026-11-14', -14), '2025-09-14');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(dateInTz('2026-08-15T03:00:00Z'), '2026-08-14', 'the business day, not UTC');
});

test('a one-off customer is offered a plan after the set number of days, once', () => {
  const c = cust({ last_visit_at: '2026-08-14T15:00:00Z' }); // +75 days = Oct 28
  assert.equal(planOutreach({ now: at('2026-10-27'), settings, customers: [c], plans: [] }).length, 0);
  const hit = planOutreach({ now: at('2026-10-29'), settings, customers: [c], plans: [] });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].kind, 'plan_offer');
  assert.equal(hit[0].token, 't1');
  const again = planOutreach({ now: at('2026-10-30'), settings, customers: [c], plans: [], logged: [`c1|${hit[0].dedupe}`] });
  assert.equal(again.length, 0, 'not sent twice');
  assert.equal(planOutreach({ now: at('2026-11-12'), settings: { ...settings, rebook_enabled: false }, customers: [c], plans: [] }).length, 0, 'the window closes');
});

test('rebooking follows the months since the last visit', () => {
  const c = cust({ last_visit_at: '2026-05-10T15:00:00Z' }); // 6 months = Nov 10; no plan offer enabled here
  const s = { ...settings, plan_offer_enabled: false };
  const hit = planOutreach({ now: at('2026-11-12'), settings: s, customers: [c], plans: [] });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].kind, 'rebook');
  assert.match(hit[0].dedupe, /^rebook:6:/);
  assert.equal(planOutreach({ now: at('2026-11-12'), settings: { ...s, rebook_enabled: false }, customers: [c], plans: [] }).length, 0);
});

test('nobody is messaged who opted out, has work booked, has no contact, or last had restoration', () => {
  const now = at('2026-10-29');
  for (const over of [{ opt_out: true }, { has_open_work: true }, { phone: '', email: '' }, { last_job: { id: 'j', token: 't', type: 'water_restoration' } }]) {
    assert.equal(planOutreach({ now, settings, customers: [cust(over)], plans: [] }).length, 0, JSON.stringify(over));
  }
});

test('a customer with a plan gets plan reminders, not offers', () => {
  const plan = { id: 'p1', customer_id: 'c1', status: 'active', next_due: '2026-11-20', interval_months: 3, name: 'Quarterly' };
  const c = cust({ last_visit_at: '2026-08-20T15:00:00Z' });
  assert.equal(planOutreach({ now: at('2026-11-01'), settings, customers: [c], plans: [plan] }).length, 0, 'earlier than 14 days before');
  const hit = planOutreach({ now: at('2026-11-10'), settings, customers: [c], plans: [plan] });
  assert.equal(hit[0].kind, 'plan_reminder');
  assert.equal(hit[0].plan_id, 'p1');
  assert.equal(planOutreach({ now: at('2026-11-10'), settings: { ...settings, plan_remind_enabled: false }, customers: [c], plans: [plan] }).length, 0);
  assert.equal(planOutreach({ now: at('2026-11-10'), settings, customers: [c], plans: [{ ...plan, status: 'paused' }] }).length, 0, 'paused plans stay quiet');
});

test('a plan moves to its next date when the visit is near the due date', () => {
  const plan = { status: 'active', next_due: '2026-11-20', interval_months: 3 };
  assert.equal(advancePlan(plan, '2026-11-18T17:00:00Z'), '2027-02-18');
  assert.equal(advancePlan(plan, '2026-12-05T17:00:00Z'), '2027-03-05', 'late visits count too');
  assert.equal(advancePlan(plan, '2026-09-01T17:00:00Z'), null, 'a visit months early is a different job');
  assert.equal(advancePlan({ ...plan, status: 'paused' }, '2026-11-18T17:00:00Z'), null);
});

test('messages use the owner wording and always include a way to opt out', () => {
  const m = buildOutreachMessages({ kind: 'rebook', business: 'Acme', firstName: 'Pat', link: 'https://x.com/c/t' });
  assert.match(m.sms, /Pat/);
  assert.match(m.sms, /https:\/\/x\.com\/c\/t/);
  assert.match(m.sms, /STOP/);
  assert.match(m.html, /Stop reminders/);
  const c = buildOutreachMessages({ kind: 'plan_offer', custom: '{first}, {business} here: {link}', business: 'Acme', firstName: '', link: 'L' });
  assert.match(c.sms, /^there, Acme here: L/);
  assert.equal(renderTemplate('{first} {nope}', { first: 'A' }), 'A {nope}');
});

test('the mailing list keeps the right age, skips opt-outs and customers with no address', () => {
  const now = new Date('2026-11-14T16:00:00Z');
  const a = (street) => [{ street, unit: '', city: 'KC', state: 'MO', zip: '64111', created_at: '2020-01-01' }];
  const list = [
    { display_name: 'In range', customer_type: 'residential', last_visit_at: '2025-11-01T16:00:00Z', addresses: a('1 Main') },
    { display_name: 'Too recent', customer_type: 'residential', last_visit_at: '2026-06-01T16:00:00Z', addresses: a('2 Main') },
    { display_name: 'Too old', customer_type: 'residential', last_visit_at: '2024-01-01T16:00:00Z', addresses: a('3 Main') },
    { display_name: 'Opted out', customer_type: 'residential', last_visit_at: '2025-11-01T16:00:00Z', marketing_opt_out: true, addresses: a('4 Main') },
    { display_name: 'No address', customer_type: 'residential', last_visit_at: '2025-11-01T16:00:00Z', addresses: [] },
    { display_name: 'Office, "LLC"', customer_type: 'commercial', last_visit_at: '2025-10-20T16:00:00Z', addresses: a('5 Main') },
  ];
  const rows = mailingRows(list, { fromMonths: 11, toMonths: 14, now });
  assert.deepEqual(rows.map((r) => r[0]), ['Office, "LLC"', 'In range']);
  assert.equal(mailingRows(list, { fromMonths: 11, toMonths: 14, now, types: ['residential'] }).length, 1);
  const csv = toCsv(MAILING_HEADER, rows);
  assert.match(csv, /"Office, ""LLC"""/);
  assert.equal(csv.split('\r\n').length, 3);
});

test('aftercare comes from the price list and the signed after-cleaning record', () => {
  const items = { a: { name: 'Carpet cleaning', aftercare: 'Stay off for 2 hours.', dry_hours: 6 }, b: { name: 'Protectant', aftercare: '', dry_hours: 10 } };
  const lines = [{ price_item_id: 'a' }, { price_item_id: 'a' }, { price_item_id: 'b' }, { price_item_id: null }];
  const r = aftercareFor({ lines, items, defaultText: 'Vacuum lightly after 24 hours.' });
  assert.deepEqual(r.notes.map((n) => n.service), ['', 'Carpet cleaning']);
  assert.equal(r.dryHours, 10, 'the longest drying time');
  assert.equal(aftercareFor({ lines, items, postDryHours: 4 }).dryHours, 4, 'what the tech recorded wins');
  assert.equal(aftercareFor({ lines: [{ price_item_id: null }], items: {} }).hasContent, false);
  const m = buildAftercareMessages({ business: 'Acme', customerName: 'Pat Lee', link: 'https://x/c/t', notes: r.notes, dryHours: r.dryHours });
  assert.match(m.sms, /about 10 hours/);
  assert.match(m.sms, /https:\/\/x\/c\/t/);
  assert.match(m.text, /Stay off for 2 hours/);
});

test('the public forms are checked', () => {
  assert.ok(cleanProblem({ kind: 'nope' }).error);
  assert.ok(cleanProblem({ kind: 'other', details: 'hi' }).error);
  assert.deepEqual(cleanProblem({ kind: 'spot_returned', details: ' it came back ', phone: '816-555-0100 x<script>' }).value, { kind: 'spot_returned', details: 'it came back', contact_phone: '816-555-0100 ' });
  assert.ok(cleanRequest({ kind: 'plan', interval_months: 5 }).error);
  assert.deepEqual(cleanRequest({ kind: 'plan', interval_months: '3', preferred_times: 'Mornings' }).value, { kind: 'plan', preferred_times: 'Mornings', interval_months: 3 });
  assert.equal(cleanRequest({ kind: 'weird' }).value.kind, 'rebook');
});
