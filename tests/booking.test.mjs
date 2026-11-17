import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BOOKING, normalizeBooking, validateBookingSettings, computeOpenSlots, findSlot, countSlots, blockingCount,
  zonedToUtcMs, tzOffsetMs, localDateStr, addDaysStr, isoDow, parseHm, fmtHm,
  fmtSlotDay, fmtSlotTime, fmtSlotRange, fmtSlotFull,
} from '../lib/booking.js';
import { cleanQuantity, buildLines, priceBooking } from '../lib/bookingPrice.js';
import { buildBookingMessages } from '../lib/bookingMessages.js';

const CT = 'America/Chicago';
// Tuesday 2026-11-17, 2:00 pm Central (CST = UTC-6)
const NOW = new Date('2026-11-17T20:00:00Z');
const settings = (over = {}) => ({ ...DEFAULT_BOOKING, timezone: CT, ...over });
const local = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: CT, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: false });
const v = (startIso, hours = 2, extra = {}) => ({ starts_at: startIso, ends_at: new Date(new Date(startIso).getTime() + hours * 3600000).toISOString(), ...extra });

// ------------------------------------------------------------------ time zone helpers
test('central time converts both ways, across the daylight saving change', () => {
  assert.equal(new Date(zonedToUtcMs(2026, 11, 18, 8, 0, CT)).toISOString(), '2026-11-18T14:00:00.000Z'); // CST
  assert.equal(new Date(zonedToUtcMs(2026, 6, 18, 8, 0, CT)).toISOString(), '2026-06-18T13:00:00.000Z'); // CDT
  assert.equal(new Date(zonedToUtcMs(2027, 3, 12, 8, 0, CT)).toISOString(), '2027-03-12T14:00:00.000Z'); // day before the change
  assert.equal(new Date(zonedToUtcMs(2027, 3, 15, 8, 0, CT)).toISOString(), '2027-03-15T13:00:00.000Z'); // after it
  assert.equal(tzOffsetMs(Date.parse('2026-11-18T14:00:00Z'), CT), -6 * 3600000);
});

test('the date and weekday follow the business zone, not UTC', () => {
  // 11 pm Central on the 17th is already the 18th in UTC
  assert.equal(localDateStr(Date.parse('2026-11-18T05:00:00Z'), CT), '2026-11-17');
  assert.equal(addDaysStr('2026-11-30', 1), '2026-12-01');
  assert.equal(isoDow('2026-11-16'), 1); // Monday
  assert.equal(isoDow('2026-11-22'), 7); // Sunday
});

test('times parse and print as HH:MM', () => {
  assert.equal(parseHm('08:00:00'), 480);
  assert.equal(parseHm('17:30'), 1050);
  assert.equal(parseHm('25:00'), null);
  assert.equal(parseHm(''), null);
  assert.equal(fmtHm(1050), '17:30');
});

// ------------------------------------------------------------------ the slot grid
test('a 2 hour slot with a 1 hour gap in an 8 to 5 day gives three slots', () => {
  const cfg = normalizeBooking(settings());
  assert.deepEqual(cfg.starts, [480, 660, 840]); // 8:00, 11:00, 2:00
  assert.equal(normalizeBooking(settings({ booking_day_end: '18:00' })).starts.length, 3);
  assert.deepEqual(normalizeBooking(settings({ booking_day_start: '07:00', booking_day_end: '19:00' })).starts, [420, 600, 780, 960]);
});

test('open slots are two hours long with a gap, in Central time, on working days only', () => {
  const { days, tz } = computeOpenSlots({ now: NOW, settings: settings(), busy: [] });
  assert.equal(tz, CT);
  const thu = days.find((d) => d.date === '2026-11-19');
  assert.equal(thu.slots.length, 3);
  assert.deepEqual(thu.slots.map((s) => s.start), ['2026-11-19T14:00:00.000Z', '2026-11-19T17:00:00.000Z', '2026-11-19T20:00:00.000Z']);
  assert.deepEqual(thu.slots.map((s) => new Date(s.end) - new Date(s.start)), [7200000, 7200000, 7200000]);
  // 1 hour between the end of one and the start of the next
  assert.equal(new Date(thu.slots[1].start) - new Date(thu.slots[0].end), 3600000);
  // no Saturday (21st) or Sunday (22nd)
  assert.ok(!days.some((d) => d.date === '2026-11-21' || d.date === '2026-11-22'));
  // the window is 30 days from today
  assert.ok(days.every((d) => d.date <= '2026-12-17'));
});

test('minimum notice hides the slots that start too soon', () => {
  // now is Tuesday 2 pm and notice is 24 hours: only Wednesday 2 pm onward is bookable
  const { days } = computeOpenSlots({ now: NOW, settings: settings(), busy: [] });
  const tue = days.find((d) => d.date === '2026-11-17');
  assert.equal(tue, undefined);
  const wed = days.find((d) => d.date === '2026-11-18');
  assert.deepEqual(wed.slots.map((s) => local(s.start)), ['Wed 14:00']);
  const none = computeOpenSlots({ now: NOW, settings: settings({ booking_notice_hours: 0 }), busy: [] }).days;
  assert.deepEqual(none.find((d) => d.date === '2026-11-17').slots.map((s) => local(s.start)), ['Tue 14:00']);
});

test('a booked visit closes its slot but not the next one, because of the gap', () => {
  const busy = [v('2026-11-19T14:00:00Z')]; // Thursday 8 to 10
  const thu = computeOpenSlots({ now: NOW, settings: settings(), busy }).days.find((d) => d.date === '2026-11-19');
  assert.deepEqual(thu.slots.map((s) => local(s.start)), ['Thu 11:00', 'Thu 14:00']);
});

test('an odd-time visit also closes the slots it crowds', () => {
  const busy = [v('2026-11-19T16:30:00Z')]; // Thursday 10:30 to 12:30
  const thu = computeOpenSlots({ now: NOW, settings: settings(), busy }).days.find((d) => d.date === '2026-11-19');
  // 8-10 is within the gap of a 10:30 start, 11-1 overlaps; 2-4 is more than an hour after 12:30
  assert.deepEqual(thu.slots.map((s) => local(s.start)), ['Thu 14:00']);
});

test('a slot stays open until as many visits overlap it as there are crews', () => {
  const one = [v('2026-11-19T14:00:00Z')];
  const two = [v('2026-11-19T14:00:00Z'), v('2026-11-19T14:00:00Z')];
  const open = (busy, crews) => computeOpenSlots({ now: NOW, settings: settings({ booking_crews: crews }), busy }).days.find((d) => d.date === '2026-11-19').slots.length;
  assert.equal(open(one, 1), 2);
  assert.equal(open(one, 2), 3);
  assert.equal(open(two, 2), 2);
});

test('the window, working days and hours come from settings', () => {
  const sat = computeOpenSlots({ now: NOW, settings: settings({ booking_days: [6], booking_window_days: 8 }), busy: [] });
  assert.deepEqual(sat.days.map((d) => d.date), ['2026-11-21']);
  const long = computeOpenSlots({ now: NOW, settings: settings({ booking_day_start: '07:00', booking_day_end: '19:00' }), busy: [] }).days.find((d) => d.date === '2026-11-19');
  assert.equal(long.slots.length, 4);
});

test('after the clocks change the slots keep the same Central times', () => {
  const now = new Date('2027-03-10T18:00:00Z');
  const { days } = computeOpenSlots({ now, settings: settings({ booking_notice_hours: 0 }), busy: [] });
  const before = days.find((d) => d.date === '2027-03-12').slots[0].start;
  const after = days.find((d) => d.date === '2027-03-15').slots[0].start;
  assert.equal(before, '2027-03-12T14:00:00.000Z');
  assert.equal(after, '2027-03-15T13:00:00.000Z');
});

test('findSlot and countSlots read the result', () => {
  const { days } = computeOpenSlots({ now: NOW, settings: settings(), busy: [] });
  assert.equal(findSlot(days, '2026-11-19T17:00:00Z').end, '2026-11-19T19:00:00.000Z');
  assert.equal(findSlot(days, '2026-11-19T17:30:00Z'), null);
  assert.equal(findSlot(days, 'nonsense'), null);
  assert.equal(countSlots(days), days.reduce((n, d) => n + d.slots.length, 0));
});

test('blockingCount counts overlaps and the gap on both sides', () => {
  const H = 3600000;
  const slot = [10 * H, 12 * H];
  assert.equal(blockingCount([[8 * H, 10 * H]], slot[0], slot[1], H), 1); // ends exactly at the start: inside the gap
  assert.equal(blockingCount([[8 * H, 9 * H]], slot[0], slot[1], H), 0); // ends one hour before: allowed
  assert.equal(blockingCount([[13 * H, 15 * H]], slot[0], slot[1], H), 0); // starts one hour after: allowed
  assert.equal(blockingCount([[12.5 * H, 14 * H]], slot[0], slot[1], H), 1);
});

// ------------------------------------------------------------------ the settings form
test('the settings form accepts good values and rejects bad ones', () => {
  const good = { ...DEFAULT_BOOKING };
  const ok = validateBookingSettings(good);
  assert.equal(ok.error, undefined);
  assert.equal(ok.value.booking_day_start, '08:00');
  assert.deepEqual(ok.value.booking_days, [1, 2, 3, 4, 5]);
  assert.match(validateBookingSettings({ ...good, booking_days: [] }).error, /day of the week/);
  assert.match(validateBookingSettings({ ...good, booking_day_end: '07:00' }).error, /after the first/);
  assert.match(validateBookingSettings({ ...good, booking_day_start: '15:30', booking_day_end: '16:30' }).error, /too short/);
  assert.match(validateBookingSettings({ ...good, booking_crews: 0 }).error, /Jobs at the same time/);
  assert.match(validateBookingSettings({ ...good, booking_slot_minutes: 10 }).error, /Appointment length/);
  assert.match(validateBookingSettings({ ...good, booking_window_days: 200 }).error, /How far ahead/);
  assert.match(validateBookingSettings({ ...good, booking_day_start: '' }).error, /start time/);
});

test('settings that came back from the database as HH:MM:SS still work', () => {
  const cfg = normalizeBooking({ ...DEFAULT_BOOKING, booking_day_start: '08:00:00', booking_day_end: '17:00:00' });
  assert.deepEqual(cfg.starts, [480, 660, 840]);
});

// ------------------------------------------------------------------ wording
test('slot wording uses the business zone', () => {
  const text = (s) => s.replace(/\s/g, ' ');
  assert.equal(text(fmtSlotTime('2026-11-19T14:00:00Z', CT)), '8:00 AM');
  assert.equal(text(fmtSlotRange('2026-11-19T14:00:00Z', '2026-11-19T16:00:00Z', CT)), '8:00 AM to 10:00 AM');
  assert.equal(text(fmtSlotFull('2026-11-19T14:00:00Z', '2026-11-19T16:00:00Z', CT)), 'Thu, Nov 19, 8:00 AM to 10:00 AM');
  assert.equal(fmtSlotDay('2026-11-19'), 'Thursday, Nov 19');
});

// ------------------------------------------------------------------ pricing
const ITEMS = [
  { id: 'a', name: 'Carpet cleaning', unit: 'sqft', price: '0.30' },
  { id: 'b', name: 'Stairs', unit: 'each', price: 4 },
  { id: 'c', name: 'Protectant', unit: 'flat', price: 25 },
  { id: 'd', name: 'Extraction', unit: 'hour', price: 120 },
  { id: 'e', name: 'Bedroom', unit: 'room', price: 35 },
];

test('quantities are checked by unit', () => {
  assert.equal(cleanQuantity('sqft', '250.5'), 250.5);
  assert.equal(cleanQuantity('sqft', '0'), null);
  assert.equal(cleanQuantity('sqft', ''), null);
  assert.equal(cleanQuantity('sqft', '-4'), null);
  assert.equal(cleanQuantity('sqft', 'abc'), null);
  assert.equal(cleanQuantity('sqft', 1e9), null);
  assert.equal(cleanQuantity('room', 3), 3);
  assert.equal(cleanQuantity('room', 2.5), null);
  assert.equal(cleanQuantity('each', '12'), 12);
  assert.equal(cleanQuantity('hour', 1.25), 1.25);
  assert.equal(cleanQuantity('flat', ''), 1); // flat is always one
  assert.equal(cleanQuantity('flat', 40), 1);
});

test('the full price adds the lines up', () => {
  const r = priceBooking(ITEMS, [{ id: 'a', quantity: 600 }, { id: 'c' }], 0);
  assert.equal(r.error, undefined);
  assert.equal(r.totals.subtotalCents, 18000 + 2500);
  assert.equal(r.totals.totalCents, 20500);
  assert.equal(r.lines[0].description, 'Carpet cleaning');
  assert.equal(r.lines[1].quantity, 1);
});

test('the job minimum tops up a small job and never lowers a big one', () => {
  const small = priceBooking(ITEMS, [{ id: 'a', quantity: 100 }], 89); // $30 of work
  assert.equal(small.totals.subtotalCents, 3000);
  assert.equal(small.totals.minimumAdjustmentCents, 5900);
  assert.equal(small.totals.totalCents, 8900);
  const big = priceBooking(ITEMS, [{ id: 'a', quantity: 1000 }], 89);
  assert.equal(big.totals.minimumAdjustmentCents, 0);
  assert.equal(big.totals.totalCents, 30000);
  // the minimum applies once to the whole job, not per line
  const two = priceBooking(ITEMS, [{ id: 'a', quantity: 100 }, { id: 'b', quantity: 3 }], 89);
  assert.equal(two.totals.subtotalCents, 4200);
  assert.equal(two.totals.totalCents, 8900);
});

test('bad bookings are refused with a plain message', () => {
  assert.match(priceBooking(ITEMS, [], 0).error, /at least one/);
  assert.match(priceBooking(ITEMS, null, 0).error, /at least one/);
  assert.match(priceBooking(ITEMS, [{ id: 'zzz', quantity: 1 }], 0).error, /no longer available/);
  assert.match(priceBooking(ITEMS, [{ id: 'a', quantity: 'x' }], 0).error, /square feet for Carpet cleaning/i);
  assert.match(priceBooking(ITEMS, [{ id: 'e', quantity: 1.5 }], 0).error, /whole number for Bedroom/);
  assert.match(priceBooking(ITEMS, [{ id: 'a', quantity: 10 }, { id: 'a', quantity: 20 }], 0).error, /listed twice/);
  assert.match(priceBooking([{ id: 'f', name: 'Free', unit: 'flat', price: 0 }], [{ id: 'f' }], 0).error, /\$0/);
  const many = Array.from({ length: 21 }, (_, i) => ({ id: `x${i}`, quantity: 1 }));
  assert.match(priceBooking(ITEMS, many, 0).error, /up to 20/);
});

test('buildLines keeps the usable lines while another is still being typed', () => {
  const r = buildLines(ITEMS, [{ id: 'a', quantity: 200 }, { id: 'b', quantity: '' }]);
  assert.equal(r.lines.length, 1);
  assert.equal(r.errors.length, 1);
});

// ------------------------------------------------------------------ messages
test('the booking message has the time, the street and the link, and escapes the email', () => {
  const m = buildBookingMessages({
    business: 'Monarch <Cleaning>', customerName: 'Pat Jones', when: 'Thu, Nov 19, 8:00 AM to 10:00 AM',
    street: '12 Oak St', link: 'https://x.test/e/abc', phone: '(816) 555-1212',
  });
  assert.match(m.sms, /^Hi Pat, you're booked with Monarch <Cleaning> for Thu, Nov 19, 8:00 AM to 10:00 AM at 12 Oak St\./);
  assert.match(m.sms, /call \(816\) 555-1212/);
  assert.match(m.sms, /https:\/\/x\.test\/e\/abc/);
  assert.match(m.subject, /Thu, Nov 19/);
  assert.ok(m.html.includes('Monarch &lt;Cleaning&gt;'));
  assert.ok(!m.html.includes('<Cleaning>'));
  assert.match(m.text, /Where: 12 Oak St/);
});

test('the booking message works with very little to go on', () => {
  const m = buildBookingMessages({ when: 'Thu, 8 AM' });
  assert.match(m.sms, /^Hi, you're booked with us for Thu, 8 AM\./);
  assert.ok(!m.sms.includes('undefined'));
  assert.ok(!m.html.includes('View your booking'));
});

// ------------------------------------------------------------------ what the page sends
import { cleanBookingBody, checkSignature, leadFieldsFor, SIGNATURE_ERROR } from '../lib/bookingInput.js';

// a real 1x1 PNG
const PNG = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')}`;
const goodBody = (over = {}) => ({
  name: 'Pat Jones', signature: PNG,
  customer: { first_name: 'Pat', last_name: 'Jones', phone: '8165551212', email: 'pat@example.com' },
  address: { street: '12 Oak St', city: 'Lees Summit', state: 'mo', zip: '64081' },
  slot: '2026-11-19T14:00:00Z', items: [{ id: 'a', quantity: 200 }], ...over,
});

test('a good booking is accepted and tidied', () => {
  const r = cleanBookingBody(goodBody());
  assert.equal(r.error, undefined);
  assert.equal(r.value.phone, '(816) 555-1212');
  assert.equal(r.value.state, 'MO');
  assert.equal(r.value.kind, 'carpet');
  assert.equal(r.value.later, false);
  assert.deepEqual(r.value.items, [{ id: 'a', quantity: 200 }]);
});

test('only staff can choose the kind of job; everyone else books carpet', () => {
  assert.equal(cleanBookingBody(goodBody({ kind: 'mitigation' })).value.kind, 'carpet');
  assert.equal(cleanBookingBody(goodBody({ kind: 'mitigation' }), { staff: true }).value.kind, 'mitigation');
  assert.equal(cleanBookingBody(goodBody({ kind: 'plumbing' }), { staff: true }).value.kind, 'carpet');
});

test('a booking needs a time or an ask to be called', () => {
  assert.match(cleanBookingBody(goodBody({ slot: '' })).error, /pick a time/i);
  assert.match(cleanBookingBody(goodBody({ slot: 'soon' })).error, /pick a time/i);
  const later = cleanBookingBody(goodBody({ slot: '', later: true }));
  assert.equal(later.value.slot, null);
  assert.equal(later.value.later, true);
});

test('missing or bad details are refused with a plain message', () => {
  assert.match(cleanBookingBody(goodBody({ name: 'P' })).error, /full name/);
  assert.match(cleanBookingBody(goodBody({ signature: '' })).error, /sign/);
  assert.match(cleanBookingBody(goodBody({ signature: 'data:image/png;base64,AAAA' })).error, /sign/);
  assert.match(cleanBookingBody(goodBody({ customer: { first_name: '', last_name: '', phone: '8165551212' } })).error, /your name/);
  assert.match(cleanBookingBody(goodBody({ customer: { first_name: 'Pat', phone: '555' } })).error, /phone number/);
  assert.match(cleanBookingBody(goodBody({ customer: { first_name: 'Pat', phone: '8165551212', email: 'nope' } })).error, /email/);
  assert.match(cleanBookingBody(goodBody({ address: { street: '', city: 'X' } })).error, /street address/);
  assert.match(cleanBookingBody(goodBody({ address: { street: '12 Oak St', city: '' } })).error, /city/);
  assert.match(cleanBookingBody(goodBody({ address: { street: '12 Oak St', city: 'X', state: 'M1' } })).error, /two letters/);
});

test('the email is optional and long text is cut down', () => {
  const r = cleanBookingBody(goodBody({ customer: { first_name: 'Pat', phone: '8165551212' }, notes: 'x'.repeat(5000), address: { street: '12 Oak St', city: 'X', warnings: 'y'.repeat(900) } }));
  assert.equal(r.error, undefined);
  assert.equal(r.value.email, '');
  assert.equal(r.value.notes.length, 1000);
  assert.equal(r.value.warnings.length, 300);
});

test('the signature check wants a real PNG', () => {
  assert.equal(checkSignature(PNG), null);
  assert.equal(checkSignature(undefined), SIGNATURE_ERROR);
  assert.equal(checkSignature('data:image/jpeg;base64,AAAA'), SIGNATURE_ERROR);
  assert.equal(checkSignature(`data:image/png;base64,${Buffer.from('not a png at all').toString('base64')}`), SIGNATURE_ERROR);
  assert.equal(checkSignature(`${PNG}${'A'.repeat(500000)}`), SIGNATURE_ERROR);
});

test('each kind of job maps to the lead fields the app already uses', () => {
  assert.deepEqual(leadFieldsFor('carpet'), { job_type: 'floor_cleaning', restoration_type: null });
  assert.deepEqual(leadFieldsFor('extraction'), { job_type: 'water_restoration', restoration_type: 'extraction' });
});
