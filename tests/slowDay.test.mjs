import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSlowDay, findSlowDays, planSlowDayOffers, slowDayDiscountCents, slowDayDiscountLine, offerStatus, limitDaysToOffer,
  daysPhrase, buildSlowDayMessages, slowDayDedupe,
} from '../lib/slowDay.js';
import { estimateTotals } from '../lib/estimate.js';

// Monday Nov 23 2026, 10:00 Central. Booking days Mon-Fri, 8:00-17:00, 2h slots with a 1h gap: 8-10, 11-1, 2-4 (three slots a day).
const now = new Date('2026-11-23T16:00:00Z');
const base = { timezone: 'America/Chicago', booking_days: [1, 2, 3, 4, 5], booking_day_start: '08:00', booking_day_end: '17:00', booking_slot_minutes: 120, booking_gap_minutes: 60, booking_crews: 1, booking_notice_hours: 24, booking_window_days: 14 };
const visit = (day, hour) => { const s = new Date(`2026-11-${day}T${String(hour + 6).padStart(2, '0')}:00:00Z`); return { starts_at: s.toISOString(), ends_at: new Date(s.getTime() + 2 * 3600000).toISOString() }; };

test('settings stay inside their limits', () => {
  const n = normalizeSlowDay({ slowday_percent: 90, slowday_open_share: 1, slowday_max_dates: 0, slowday_min_notice_hours: -4 });
  assert.equal(n.percent, 50); assert.equal(n.openShare, 10); assert.equal(n.maxDates, 1); assert.equal(n.minNotice, 0);
  assert.equal(normalizeSlowDay({}).enabled, false);
  assert.equal(normalizeSlowDay({ slowday_enabled: true }).enabled, true);
});

test('slow days: mostly-open days after the cutoff, emptiest first, then in date order', () => {
  // Tue 24 has nothing booked but is inside the 48h cutoff; Wed 25 is empty but loses its first time to the cutoff; Thu 26 has one of three booked; Fri 27 has two of three booked.
  const busy = [visit(26, 8), visit(27, 8), visit(27, 11)];
  const days = findSlowDays({ now, settings: { ...base, slowday_open_share: 60, slowday_min_notice_hours: 48, slowday_look_ahead_days: 7, slowday_max_dates: 10 }, busy });
  const dates = days.map((d) => d.date);
  assert.ok(!dates.includes('2026-11-24'), 'inside the cutoff');
  assert.ok(dates.includes('2026-11-25')); // the cutoff lands mid-morning, so its first time is gone but 2 of 3 are still open
  assert.ok(dates.includes('2026-11-26')); // 2 of 3 open = 67%
  assert.ok(!dates.includes('2026-11-27')); // 1 of 3 open = 33%
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(days.find((d) => d.date === '2026-11-25').share, 67);
  assert.equal(days.find((d) => d.date === '2026-11-30').share, 100);
});

test('slow days: the cap keeps the emptiest, and weekends are never offered', () => {
  const days = findSlowDays({ now, settings: { ...base, slowday_max_dates: 2, slowday_look_ahead_days: 10 }, busy: [visit(30, 8)] });
  assert.equal(days.length, 2);
  assert.ok(days.every((d) => !['2026-11-28', '2026-11-29'].includes(d.date)));
  assert.ok(!days.some((d) => d.date === '2026-11-30')); // one booked: not the emptiest
});

test('slow days: nothing when the day is busy or there are no slots', () => {
  const all = [];
  for (const d of [25, 26, 27, 30]) for (const h of [8, 11, 14]) all.push(visit(d, h));
  assert.deepEqual(findSlowDays({ now, settings: { ...base, slowday_look_ahead_days: 5 }, busy: all }), []);
  assert.deepEqual(findSlowDays({ now, settings: { ...base, booking_days: [1], booking_window_days: 1 }, busy: [] }), []);
});

const cust = (id, over = {}) => ({ id, display_name: id, first_name: id, phone: '4175550100', email: '', opt_out: false, has_open_work: false,
  last_visit_at: '2026-01-01T00:00:00Z', last_job: { id: `j${id}`, token: `t${id}`, type: 'floor_cleaning' }, ...over });

test('offers go to carpet customers due longest ago, within the daily cap, with reasons for the rest', () => {
  const r = planSlowDayOffers({
    now, settings: { slowday_max_per_day: 2, slowday_quiet_days: 60 },
    customers: [
      cust('a', { last_visit_at: '2025-02-01T00:00:00Z' }), cust('b', { last_visit_at: '2025-06-01T00:00:00Z' }), cust('c'),
      cust('stop', { opt_out: true }), cust('none', { phone: '' }), cust('open', { has_open_work: true }), cust('lately'), cust('today'),
      cust('fresh', { last_visit_at: '2026-11-01T00:00:00Z' }),
      cust('water', { last_job: { id: 'jw', token: 'tw', type: 'water_restoration' } }),
    ],
    offeredLately: ['lately'], blocked: ['c:today'],
  });
  assert.deepEqual(r.eligible.map((c) => c.id), ['a', 'b']);
  assert.equal(r.overflow, 1);
  assert.deepEqual(r.skipped.map((s) => s.reason).sort(), ['messaged_today', 'no_contact', 'offered_lately', 'open_work', 'opted_out', 'recent']);
  assert.ok(!r.skipped.some((s) => s.name === 'water'), 'restoration customers are not offered carpet discounts');
});

test('discount: a percent, never below the job minimum, none when already at the minimum', () => {
  assert.equal(slowDayDiscountCents(20000, 12500, 10), 2000);
  assert.equal(slowDayDiscountCents(13000, 12500, 10), 500); // capped so the total stays at the minimum
  assert.equal(slowDayDiscountCents(12500, 12500, 10), 0);
  assert.equal(slowDayDiscountCents(9999, 12500, 10), 0);
  assert.equal(slowDayDiscountCents(10001, 0, 15), 1500); // 1500.15 rounds to the cent
  assert.equal(slowDayDiscountCents(20000, 0, 99), 10000); // percent is held to 50
});

test('discount line: negative custom line that the estimate math handles', () => {
  const lines = [{ quantity: 1, unit_price: 200, unit: 'flat' }];
  const dl = slowDayDiscountLine({ totalCents: 20000, minimumCents: 12500, percent: 10 });
  assert.equal(dl.unit_price, -20); assert.equal(dl.is_custom, true); assert.equal(dl.description, 'Slow-day offer (10% off)');
  assert.equal(estimateTotals([...lines, dl], 125).totalCents, 18000);
  const capped = slowDayDiscountLine({ totalCents: 13000, minimumCents: 12500, percent: 10 });
  assert.equal(estimateTotals([{ quantity: 1, unit_price: 130, unit: 'flat' }, capped], 125).totalCents, 12500); // no minimum top-up undoes it
  assert.equal(slowDayDiscountLine({ totalCents: 12500, minimumCents: 12500, percent: 10 }), null);
});

test('offer link: good once, until its last day', () => {
  const o = { used_at: null, expires_on: '2026-11-27' };
  assert.deepEqual(offerStatus(o, { now: new Date('2026-11-27T20:00:00Z') }), { ok: true });
  assert.equal(offerStatus(o, { now: new Date('2026-11-28T08:00:00Z') }).reason, 'expired');
  assert.equal(offerStatus({ ...o, used_at: '2026-11-24T00:00:00Z' }, { now }).reason, 'used');
  assert.equal(offerStatus(null, { now }).reason, 'not_found');
  const days = [{ date: '2026-11-25' }, { date: '2026-11-26' }, { date: '2026-11-30' }];
  assert.deepEqual(limitDaysToOffer(days, ['2026-11-26', '2026-11-30']).map((d) => d.date), ['2026-11-26', '2026-11-30']);
});

test('message: says the days and the percent, one link, STOP line, care link for stopping', () => {
  assert.equal(daysPhrase(['2026-11-25']), 'Wed, Nov 25');
  assert.equal(daysPhrase(['2026-11-25', '2026-11-26']), 'Wed, Nov 25 and Thu, Nov 26');
  assert.equal(daysPhrase(['2026-11-25', '2026-11-26', '2026-11-30']), 'Wed, Nov 25, Thu, Nov 26 and Mon, Nov 30');
  const m = buildSlowDayMessages({ business: 'Monarch', firstName: 'Sam', percent: 10, dates: ['2026-11-25', '2026-11-26'], link: 'https://x.test/book?offer=T', careLink: 'https://x.test/c/abc' });
  assert.match(m.sms, /^Hi Sam, Monarch has openings on Wed, Nov 25 and Thu, Nov 26\./);
  assert.match(m.sms, /10% off/); assert.match(m.sms, /Reply STOP to opt out\.$/);
  assert.match(m.text, /https:\/\/x\.test\/c\/abc/); assert.match(m.html, /Book with 10% off/);
  assert.match(m.subject, /10% off a carpet cleaning/);
  const c = buildSlowDayMessages({ business: 'Monarch', custom: '{percent} off on {days} from {business}: {link}', firstName: 'Sam', percent: 15, dates: ['2026-11-25'], link: 'L', careLink: 'C' });
  assert.match(c.sms, /^15 off on Wed, Nov 25 from Monarch: L Reply STOP/);
  assert.equal(slowDayDedupe('tok'), 'slowday:tok');
});
