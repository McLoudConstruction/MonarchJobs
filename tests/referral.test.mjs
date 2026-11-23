import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCode, cleanCode, cleanReferralForm, referralCredit, referralStatus, summarize, referralLink, CODE_ALPHABET, CODE_LENGTH } from '../lib/referral.js';

test('codes use only the clear alphabet and the set length', () => {
  for (let i = 0; i < 200; i += 1) {
    const c = makeCode();
    assert.equal(c.length, CODE_LENGTH);
    assert.ok([...c].every((ch) => CODE_ALPHABET.includes(ch)));
  }
  assert.equal(makeCode(() => 0.999999), 'Z'.repeat(0) + CODE_ALPHABET[CODE_ALPHABET.length - 1].repeat(CODE_LENGTH));
});

test('cleanCode tidies what people type', () => {
  assert.equal(cleanCode(' ab-cd 2345 '), 'ABCD2345');
  assert.equal(cleanCode('abc'), '');
  assert.equal(cleanCode('x'.repeat(13)), '');
  assert.equal(cleanCode(null), '');
});

test('referral link has no double slash', () => {
  assert.equal(referralLink('https://x.com/', 'ABCD2345'), 'https://x.com/r/ABCD2345');
});

test('form needs a name and a way to reach the friend', () => {
  assert.match(cleanReferralForm({}).error, /first name/);
  assert.match(cleanReferralForm({ first_name: 'Sam' }).error, /phone number or an email/);
  assert.match(cleanReferralForm({ first_name: 'Sam', phone: '555' }).error, /too short/);
  assert.match(cleanReferralForm({ first_name: 'Sam', email: 'nope' }).error, /email/);
  const ok = cleanReferralForm({ first_name: ' Sam ', phone: '(417) 555-0100', website: '' });
  assert.equal(ok.value.first_name, 'Sam');
  assert.equal(ok.value.phone, '4175550100');
  assert.equal(ok.value.honeypot, false);
  assert.equal(cleanReferralForm({ first_name: 'Sam', email: 'S@X.com', website: 'spam' }).value.honeypot, true);
});

test('no reward for the referrer themself or an existing customer', () => {
  assert.deepEqual(referralCredit({ referrerId: 'a', matches: [] }), { credit: true, reason: '' });
  assert.equal(referralCredit({ referrerId: 'a', matches: ['a'] }).reason, 'self');
  assert.equal(referralCredit({ referrerId: 'a', matches: ['b'] }).reason, 'existing_customer');
  assert.equal(referralCredit({ referrerId: '', matches: [] }).credit, false);
});

test('status follows the job and the owner', () => {
  assert.equal(referralStatus({ jobStatus: 'booked' }), 'waiting');
  assert.equal(referralStatus({}), 'waiting');
  assert.equal(referralStatus({ jobStatus: 'completed' }), 'earned');
  assert.equal(referralStatus({ jobStatus: 'closed', paid_at: '2026-11-22' }), 'paid');
  assert.equal(referralStatus({ jobStatus: 'closed', voided: true, paid_at: 'x' }), 'void');
  assert.deepEqual(summarize([{ status: 'paid' }, { status: 'earned' }, { status: 'earned' }]), { waiting: 0, earned: 2, paid: 1, void: 0 });
});
