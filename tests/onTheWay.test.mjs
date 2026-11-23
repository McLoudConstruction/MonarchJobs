import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldNotify, arrivalAt, timeText, buildOnTheWayMessages, landingStatus, etaFromSeconds } from '../lib/onTheWay.js';

test('only a fresh On the way tap texts the customer, and only when the switch is on', () => {
  const now = new Date('2026-11-20T15:00:00Z');
  assert.equal(shouldNotify({ action: 'on_the_way', enabled: true, when: now, now }), true);
  assert.equal(shouldNotify({ action: 'on_the_way', enabled: undefined, when: now, now }), true);
  assert.equal(shouldNotify({ action: 'on_the_way', enabled: false, when: now, now }), false);
  assert.equal(shouldNotify({ action: 'started', enabled: true, when: now, now }), false);
  assert.equal(shouldNotify({ action: 'on_the_way', enabled: true, when: new Date(now - 31 * 60000), now }), false);
  assert.equal(shouldNotify({ action: 'on_the_way', enabled: true, when: new Date(now - 10 * 60000), now }), true);
});

test('arrival time is the tap plus the minutes', () => {
  const a = arrivalAt('2026-11-20T15:00:00Z', 20);
  assert.equal(a.toISOString(), '2026-11-20T15:20:00.000Z');
  assert.equal(arrivalAt(null, 20), null);
  assert.equal(arrivalAt('2026-11-20T15:00:00Z', 0), null);
  assert.equal(timeText(a, 'America/Chicago'), '9:20 AM');
  assert.equal(timeText(null), '');
});

test('the message gives minutes and a link, and never a staff name', () => {
  const m = buildOnTheWayMessages({ business: 'Monarch Cleaning', customerName: 'Sam Rivera', minutes: 20, arrive: '9:20 AM', link: 'https://x.com/v/t' });
  assert.match(m.sms, /^Hi Sam, Monarch Cleaning is about 20 minutes away \(around 9:20 AM\)\. Follow along here: https:\/\/x\.com\/v\/t$/);
  assert.equal(m.subject, 'Monarch Cleaning is on the way');
  assert.match(m.html, /href="https:\/\/x\.com\/v\/t"/);
  const late = buildOnTheWayMessages({ business: 'Monarch', minutes: 40, link: 'L', late: true });
  assert.match(late.sms, /^Hi, A quick update: Monarch is about 40 minutes away\./);
  assert.match(late.subject, /Updated arrival time/);
  assert.match(buildOnTheWayMessages({ business: '', link: 'L' }).sms, /Our team is on the way/);
  const evil = buildOnTheWayMessages({ business: '<b>X</b>', link: 'L' });
  assert.ok(!evil.html.includes('<b>X</b>'));
});

test('the landing page words follow the visit step', () => {
  const v = { status: 'on_the_way', minutes_out: 30, on_the_way_at: '2026-11-20T15:00:00Z' };
  const s = landingStatus(v, { timeZone: 'America/Chicago' });
  assert.equal(s.headline, 'We are about 30 minutes away');
  assert.match(s.detail, /around 9:30 AM/);
  assert.equal(landingStatus({ status: 'started' }).headline, 'We are working at your place now');
  assert.equal(landingStatus({ status: 'finished' }).step, 'finished');
  assert.match(landingStatus({ status: 'scheduled' }).detail, /update when we are on the way/);
  assert.equal(landingStatus(null).step, 'scheduled');
  assert.deepEqual(Object.keys(landingStatus(v)).sort(), ['arriveAt', 'detail', 'headline', 'step']);
});

test('live drive time rounds up to the next 5 minutes, between 5 and 120', () => {
  assert.deepEqual(etaFromSeconds(17 * 60), { exact: 17, rounded: 20 });
  assert.deepEqual(etaFromSeconds(20 * 60), { exact: 20, rounded: 20 });
  assert.equal(etaFromSeconds(60).rounded, 5);
  assert.equal(etaFromSeconds(0).rounded, 5);
  assert.equal(etaFromSeconds(5 * 3600).rounded, 120);
  assert.equal(etaFromSeconds('x'), null);
  assert.equal(etaFromSeconds(-5), null);
});

test('the status page says when the time is based on traffic', () => {
  const v = { status: 'on_the_way', minutes_out: 20, on_the_way_at: '2026-11-23T15:00:00Z' };
  assert.doesNotMatch(landingStatus(v, { timeZone: 'America/Chicago' }).detail, /traffic/);
  assert.match(landingStatus({ ...v, eta_live: true }, { timeZone: 'America/Chicago' }).detail, /based on current traffic/);
});
