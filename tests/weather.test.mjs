import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLocation, classifyEvent, parseNwsAlerts, alertsToEnd, summarizeCapacity, planStormOffers, buildStormMessages, stormDedupe,
  STORM_EVENT_CHOICES, FREEZE_EVENTS,
} from '../lib/weather.js';

test('location: ZIP, coordinates or nothing', () => {
  assert.deepEqual(parseLocation('64801'), { zip: '64801' });
  assert.deepEqual(parseLocation(' 64801-1234 '), { zip: '64801' });
  assert.deepEqual(parseLocation('37.21, -93.29'), { lat: 37.21, lng: -93.29 });
  assert.deepEqual(parseLocation('37.21 -93.29'), { lat: 37.21, lng: -93.29 });
  assert.equal(parseLocation('95.0, 10'), null);
  assert.equal(parseLocation('Joplin'), null);
  assert.equal(parseLocation(''), null);
});

test('events: freeze and storm follow the switches and the owner\'s list', () => {
  assert.equal(classifyEvent('Freeze Warning', { freeze_enabled: true }), 'freeze');
  assert.equal(classifyEvent('Freeze Warning', { freeze_enabled: false, storm_enabled: true }), null);
  assert.equal(classifyEvent('Freeze Watch', { freeze_enabled: true }), null); // watches are not included
  assert.equal(classifyEvent('Tornado Warning', { storm_enabled: true, storm_events: ['Tornado Warning'] }), 'storm');
  assert.equal(classifyEvent('Severe Thunderstorm Warning', { storm_enabled: true, storm_events: ['Tornado Warning'] }), null);
  assert.equal(classifyEvent('Severe Thunderstorm Warning', { storm_enabled: true, storm_events: [] }), 'storm'); // empty list means the standard set
  assert.equal(classifyEvent('Dense Fog Advisory', { storm_enabled: true, freeze_enabled: true }), null);
  assert.equal(classifyEvent('Tornado Warning', { storm_enabled: false }), null);
  for (const e of FREEZE_EVENTS) assert.ok(!STORM_EVENT_CHOICES.includes(e));
});

const feature = (over = {}) => ({ properties: { id: 'urn:oid:1', event: 'Freeze Warning', status: 'Actual', messageType: 'Alert', severity: 'Moderate', headline: 'Freeze Warning issued', areaDesc: 'Jasper; Newton', onset: '2026-12-01T03:00:00-06:00', ends: '2026-12-01T09:00:00-06:00', ...over } });

test('feed: keeps real alerts for the area, drops tests, cancellations, duplicates and other events', () => {
  const json = { features: [
    feature(),
    feature(), // same id twice
    feature({ id: 'urn:oid:2', event: 'Tornado Warning', headline: 'Tornado' }),
    feature({ id: 'urn:oid:3', status: 'Test' }),
    feature({ id: 'urn:oid:4', messageType: 'Cancel' }),
    feature({ id: 'urn:oid:5', event: 'Wind Advisory' }),
  ] };
  const out = parseNwsAlerts(json, { freeze_enabled: true, storm_enabled: true });
  assert.deepEqual(out.map((a) => [a.nws_id, a.kind]), [['urn:oid:1', 'freeze'], ['urn:oid:2', 'storm']]);
  assert.equal(out[0].expires_at, '2026-12-01T15:00:00.000Z');
  assert.equal(parseNwsAlerts({}, { freeze_enabled: true }).length, 0);
  assert.equal(parseNwsAlerts(json, { freeze_enabled: true, storm_enabled: false }).length, 1);
});

test('ending alerts: gone from the feed or past their time', () => {
  const saved = [
    { id: 1, nws_id: 'a', status: 'open', expires_at: null },
    { id: 2, nws_id: 'b', status: 'open', expires_at: '2026-12-01T00:00:00Z' },
    { id: 3, nws_id: 'c', status: 'sent', expires_at: '2030-01-01T00:00:00Z' },
    { id: 4, nws_id: 'd', status: 'dismissed', expires_at: null },
  ];
  const now = new Date('2026-12-02T00:00:00Z');
  assert.deepEqual(alertsToEnd(saved, ['a', 'b', 'c'], now), [2]);
  assert.deepEqual(alertsToEnd(saved, [], now), [1, 2, 3]);
});

test('capacity: open times in the next days only', () => {
  const days = [
    { date: '2026-11-23', slots: [1, 2] }, { date: '2026-11-25', slots: [1] }, { date: '2026-11-28', slots: [1, 2, 3] }, { date: '2026-11-22', slots: [1] },
  ];
  const r = summarizeCapacity(days, { now: new Date('2026-11-23T18:00:00Z'), tz: 'America/Chicago', windowDays: 3 });
  assert.deepEqual(r.perDay, [{ date: '2026-11-23', open: 2 }, { date: '2026-11-25', open: 1 }]);
  assert.equal(r.total, 3);
});

const cust = (id, over = {}) => ({ id, display_name: id, first_name: id, phone: '4175550100', email: '', opt_out: false, has_open_work: false, last_visit_at: '2026-01-01T00:00:00Z', last_job: { id: `j${id}`, token: `t${id}` }, ...over });

test('storm offers: past customers, recent first, with reasons for those left out and a cap', () => {
  const r = planStormOffers({
    settings: { storm_max: 2 },
    customers: [
      cust('old', { last_visit_at: '2025-01-01T00:00:00Z' }), cust('new', { last_visit_at: '2026-10-01T00:00:00Z' }), cust('mid'),
      cust('stop', { opt_out: true }), cust('none', { phone: '' }), cust('open', { has_open_work: true }), cust('done'), cust('today'),
      { ...cust('nojob'), last_job: null },
    ],
    offered: ['done'], blocked: ['c:today'],
  });
  assert.deepEqual(r.eligible.map((c) => c.id), ['new', 'mid']);
  assert.equal(r.overflow, 1);
  assert.deepEqual(r.skipped.map((s) => s.reason).sort(), ['messaged_today', 'no_contact', 'offered', 'open_work', 'opted_out']);
});

test('storm message: calm, no staff, ends with the STOP line, one link', () => {
  const m = buildStormMessages({ business: 'Monarch', firstName: 'Sam', link: 'https://x.test/c/abc' });
  assert.match(m.sms, /^Hi Sam, after the recent storm/);
  assert.match(m.sms, /Reply STOP to opt out\.$/);
  assert.equal(m.sms.split('https://x.test/c/abc').length, 2);
  assert.match(m.text, /Stop reminders/);
  assert.match(m.html, /Request a time/);
  const custom = buildStormMessages({ business: 'Monarch', custom: 'Storm help from {business}: {link}', firstName: 'Sam', link: 'L' });
  assert.match(custom.sms, /^Storm help from Monarch: L Reply STOP/);
  assert.equal(stormDedupe(7), 'storm:7');
});
