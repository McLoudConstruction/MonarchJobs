import test from 'node:test';
import assert from 'node:assert/strict';
import { tabsFor, parseTab, tabHref, invoiceFlagCounts, invoiceBadge, dashboardBadge, legacyOwnerTab } from '../lib/dashboardTabs.js';

test('tabs follow the role', () => {
  assert.deepEqual(tabsFor('owner').map((t) => t.key), ['today', 'overview', 'invoices', 'activity', 'financials', 'work', 'customers']);
  assert.deepEqual(tabsFor('office').map((t) => t.key), ['today', 'invoices', 'activity']);
  assert.deepEqual(tabsFor('tech').map((t) => t.key), ['today', 'activity']);
  assert.equal(tabsFor('tech')[0].label, 'My day');
  assert.equal(tabsFor('office')[0].label, 'Today');
});

test('the tab comes from the address and falls back to Today', () => {
  assert.equal(parseTab('?tab=invoices', 'office'), 'invoices');
  assert.equal(parseTab('?tab=financials', 'owner'), 'financials');
  assert.equal(parseTab('?tab=owner', 'owner'), 'overview'); // the old single Owner tab
  assert.equal(parseTab('?tab=financials', 'office'), 'today'); // not allowed for this role
  assert.equal(parseTab('?tab=owner', 'office'), 'today');
  assert.equal(legacyOwnerTab('owner', '#customers'), 'customers');
  assert.equal(legacyOwnerTab('owner', '#junk'), 'overview');
  assert.equal(legacyOwnerTab('invoices', '#customers'), 'invoices');
  assert.equal(parseTab('?tab=invoices', 'tech'), 'today');
  assert.equal(parseTab('?tab=nonsense', 'owner'), 'today');
  assert.equal(parseTab('', 'owner'), 'today');
});

test('tab links keep a #section', () => {
  assert.equal(tabHref('today'), '/dashboard');
  assert.equal(tabHref('activity'), '/dashboard?tab=activity');
  assert.equal(tabHref('activity', '#messages'), '/dashboard?tab=activity#messages');
  assert.equal(tabHref('customers'), '/dashboard?tab=customers');
});

test('invoice flags count past due and drafts', () => {
  const rows = [
    { status: 'sent', balance_cents: 50000, due_date: '2026-11-01' },
    { status: 'partial', balance_cents: 2500, due_date: '2026-11-10' },
    { status: 'sent', balance_cents: 9000, due_date: '2026-12-01' }, // not due yet
    { status: 'sent', balance_cents: 0, due_date: '2026-11-01' },    // nothing owed
    { status: 'draft', balance_cents: 7000, due_date: null },
    { status: 'draft', balance_cents: 1000, due_date: '2026-10-01' }, // a draft is never "past due"
  ];
  assert.deepEqual(invoiceFlagCounts(rows, '2026-11-16'), { pastDue: 2, pastDueCents: 52500, drafts: 2 });
  assert.deepEqual(invoiceFlagCounts(null, '2026-11-16'), { pastDue: 0, pastDueCents: 0, drafts: 0 });
});

test('Invoices tab badge: past due beats drafts', () => {
  assert.deepEqual(invoiceBadge({ pastDue: 2, drafts: 5 }), { count: 2, tone: 'bad', title: '2 past due' });
  assert.equal(invoiceBadge({ pastDue: 0, drafts: 1 }).tone, 'warn');
  assert.equal(invoiceBadge({ pastDue: 0, drafts: 1 }).title, '1 draft not sent');
  assert.equal(invoiceBadge({ pastDue: 0, drafts: 0 }), null);
});

test('Dashboard badge adds activity and past due, and goes red for past due', () => {
  assert.equal(dashboardBadge({ activity: 0, pastDue: 0 }), null);
  assert.deepEqual(dashboardBadge({ activity: 3, pastDue: 0 }), { count: 3, tone: 'accent', title: '3 unread in Activity' });
  const both = dashboardBadge({ activity: 3, pastDue: 1 });
  assert.equal(both.count, 4);
  assert.equal(both.tone, 'bad');
  assert.match(both.title, /3 unread in Activity, 1 past-due invoice$/);
  assert.equal(dashboardBadge({ activity: 0, pastDue: 2 }).tone, 'bad');
});
