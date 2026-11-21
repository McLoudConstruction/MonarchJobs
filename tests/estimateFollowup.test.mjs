import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFollowupDays, contactKeys, planEstimateFollowups, buildFollowupMessages } from '../lib/estimateFollowup.js';

const settings = { estimate_followup_enabled: true, estimate_followup_days: [2, 5, 10] };
const at = (d) => new Date(`${d}T16:00:00Z`);
const est = (over = {}) => ({
  id: 'e1', status: 'sent', sent_at: '2026-11-02T16:00:00Z', first_viewed_at: null, expires_at: null, followups_paused: false,
  share_token: 'tok1', customer_id: 'c1', name: 'Pat Lee', first_name: 'Pat', phone: '(816) 555-0100', email: 'p@x.com', opt_out: false, closed: false, ...over,
});

test('follow-up days are cleaned: whole days 1 to 60, no repeats, in order, at most six', () => {
  assert.deepEqual(parseFollowupDays('10, 2 5 5'), [2, 5, 10]);
  assert.deepEqual(parseFollowupDays([3, '7', 0, 61, 2.5, 'x']), [3, 7]);
  assert.deepEqual(parseFollowupDays('1,2,3,4,5,6,7,8'), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parseFollowupDays(''), []);
});

test('nothing is sent while the owner has follow-ups switched off', () => {
  assert.equal(planEstimateFollowups({ now: at('2026-11-04'), settings: { ...settings, estimate_followup_enabled: false }, estimates: [est()] }).length, 0);
  assert.equal(planEstimateFollowups({ now: at('2026-11-04'), settings: {}, estimates: [est()] }).length, 0);
});

test('a nudge goes out on each set day after the estimate was sent, once', () => {
  assert.equal(planEstimateFollowups({ now: at('2026-11-03'), settings, estimates: [est()] }).length, 0, 'day 1 is too early');
  const first = planEstimateFollowups({ now: at('2026-11-04'), settings, estimates: [est()] });
  assert.equal(first.length, 1);
  assert.equal(first[0].step, 1);
  assert.equal(first[0].opened, false);
  assert.equal(first[0].token, 'tok1');
  const logged = [`e1|${first[0].dedupe}`];
  assert.equal(planEstimateFollowups({ now: at('2026-11-05'), settings, estimates: [est()], logged }).length, 0, 'not twice');
  const second = planEstimateFollowups({ now: at('2026-11-07'), settings, estimates: [est()], logged });
  assert.equal(second[0].step, 2);
  const third = planEstimateFollowups({ now: at('2026-11-12'), settings, estimates: [est()], logged });
  assert.equal(third[0].step, 3);
  assert.equal(planEstimateFollowups({ now: at('2026-11-20'), settings, estimates: [est()], logged }).length, 0, 'it ends after the last day');
});

test('a missed day is caught within three days, and only the latest due step is sent', () => {
  assert.equal(planEstimateFollowups({ now: at('2026-11-07'), settings, estimates: [est()] })[0].step, 2, 'steps 1 and 2 both due: send the latest');
  const done = ['e1|step:1:2026-11-02', 'e1|step:2:2026-11-02'];
  assert.equal(planEstimateFollowups({ now: at('2026-11-14'), settings, estimates: [est()], logged: done })[0].step, 3, 'step 3 fell due Nov 12; Nov 14 is inside its window');
  assert.equal(planEstimateFollowups({ now: at('2026-11-16'), settings, estimates: [est()], logged: done }).length, 0, 'the window closed Nov 15');
});

test('the wording depends on whether the customer opened the estimate', () => {
  const unopened = planEstimateFollowups({ now: at('2026-11-04'), settings, estimates: [est()] })[0];
  const opened = planEstimateFollowups({ now: at('2026-11-04'), settings, estimates: [est({ first_viewed_at: '2026-11-03T10:00:00Z' })] })[0];
  assert.equal(unopened.opened, false);
  assert.equal(opened.opened, true);
  const a = buildFollowupMessages({ opened: false, business: 'Monarch', firstName: 'Pat', link: 'https://x/e/t' });
  const b = buildFollowupMessages({ opened: true, business: 'Monarch', firstName: 'Pat', link: 'https://x/e/t' });
  assert.notEqual(a.sms, b.sms);
  assert.match(a.sms, /^Hi Pat, just checking/);
  assert.match(b.sms, /looking|taking a look/);
});

test('every text ends with the STOP line and the email says how to stop', () => {
  const m = buildFollowupMessages({ opened: false, business: 'Monarch', firstName: 'Pat', link: 'https://x/e/t' });
  assert.match(m.sms, /Reply STOP to opt out\.$/);
  assert.match(m.text, /Stop reminders about this estimate/);
  assert.match(m.html, /Stop reminders about this estimate/);
  assert.match(m.html, /https:\/\/x\/e\/t/);
});

test('the owner can write the wording, with first name, business and link filled in', () => {
  const m = buildFollowupMessages({ opened: false, custom: 'Hey {first}! {business} here. Your quote: {link}', business: 'Monarch', firstName: 'Pat', link: 'https://x/e/t' });
  assert.equal(m.sms, 'Hey Pat! Monarch here. Your quote: https://x/e/t Reply STOP to opt out.');
  const blank = buildFollowupMessages({ opened: false, business: '', firstName: '', link: 'https://x/e/t' });
  assert.match(blank.sms, /^Hi there, just checking .* from us\./);
});

test('no calm-breaking words: the default wording is polite and plain', () => {
  for (const opened of [false, true]) {
    const m = buildFollowupMessages({ opened, business: 'Monarch', firstName: 'Pat', link: 'https://x/e/t' });
    assert.doesNotMatch(m.sms, /urgent|last chance|act now|expires|!|final/i);
  }
});

test('estimates that should not be nudged are skipped', () => {
  const now = at('2026-11-04');
  const skip = (over) => planEstimateFollowups({ now, settings, estimates: [est(over)] }).length;
  assert.equal(skip({}), 1);
  assert.equal(skip({ status: 'approved' }), 0);
  assert.equal(skip({ status: 'declined' }), 0);
  assert.equal(skip({ status: 'draft' }), 0);
  assert.equal(skip({ followups_paused: true }), 0, 'the customer stopped reminders');
  assert.equal(skip({ opt_out: true }), 0, 'the customer opted out');
  assert.equal(skip({ closed: true }), 0, 'lead lost or job cancelled');
  assert.equal(skip({ phone: '', email: '' }), 0, 'nobody to write to');
  assert.equal(skip({ sent_at: null }), 0);
  assert.equal(skip({ expires_at: '2026-11-04T00:00:00Z' }), 0, 'expired');
  assert.equal(skip({ expires_at: '2026-12-02T06:00:00Z' }), 1, 'not yet expired');
});

test('sending the estimate again starts the count over', () => {
  const resent = est({ sent_at: '2026-11-10T16:00:00Z' });
  const old = ['e1|step:1:2026-11-02', 'e1|step:2:2026-11-02'];
  assert.equal(planEstimateFollowups({ now: at('2026-11-11'), settings, estimates: [resent], logged: old }).length, 0);
  const next = planEstimateFollowups({ now: at('2026-11-12'), settings, estimates: [resent], logged: old });
  assert.equal(next[0].step, 1);
  assert.equal(next[0].dedupe, 'step:1:2026-11-10');
});

test('one message per person per day, even across different estimates and records', () => {
  const now = at('2026-11-04');
  const two = [est({ id: 'e1' }), est({ id: 'e2', share_token: 'tok2' })];
  assert.equal(planEstimateFollowups({ now, settings, estimates: two }).length, 1, 'the same customer has two estimates: one message');
  const sameNumber = [est({ id: 'e1', customer_id: null }), est({ id: 'e2', customer_id: null, share_token: 'tok2', email: '' })];
  assert.equal(planEstimateFollowups({ now, settings, estimates: sameNumber }).length, 1, 'the same phone on two leads: one message');
  assert.equal(planEstimateFollowups({ now, settings, estimates: [est()], blocked: new Set(['c:c1']) }).length, 0, 'already messaged today by another reminder');
  assert.equal(planEstimateFollowups({ now, settings, estimates: [est({ customer_id: null })], blocked: ['p:8165550100'] }).length, 0, 'matched by phone');
  const different = [est({ id: 'e1' }), est({ id: 'e2', customer_id: 'c2', share_token: 'tok2', phone: '(816) 555-0199', email: 'q@x.com' })];
  assert.equal(planEstimateFollowups({ now, settings, estimates: different }).length, 2);
});

test('contact keys cover customer, phone (last ten digits) and email', () => {
  assert.deepEqual(contactKeys({ customer_id: 'c1', phone: '+1 (816) 555-0100', email: ' P@X.com ' }), ['c:c1', 'p:8165550100', 'e:p@x.com']);
  assert.deepEqual(contactKeys({ phone: '555' }), []);
  assert.deepEqual(contactKeys(), []);
});

test('the sent day is the business day, not UTC', () => {
  // sent 9 pm Chicago on Nov 2 is Nov 3 in UTC; two days later is Nov 4 local
  const e = est({ sent_at: '2026-11-03T03:00:00Z' });
  assert.equal(planEstimateFollowups({ now: at('2026-11-04'), settings, estimates: [e] }).length, 1);
  assert.equal(planEstimateFollowups({ now: at('2026-11-04'), settings, estimates: [e] })[0].dedupe, 'step:1:2026-11-02');
});
