import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordStrength, STRENGTH_LABELS } from '../lib/passwordStrength.js';

const score = (pw, ctx) => passwordStrength(pw, ctx).score;

test('nothing typed scores 0 with no label', () => {
  assert.deepEqual(passwordStrength(''), { score: 0, label: '', tip: '', flagged: false });
  assert.equal(passwordStrength(undefined).score, 0);
});

test('short passwords are Weak', () => {
  assert.equal(score('a'), 1);
  assert.equal(score('Ab1!'), 1);
  assert.equal(passwordStrength('Ab1!').label, 'Weak');
});

test('length and variety raise the score', () => {
  assert.equal(score('monarch1x'), 1);                 // 9 chars, two kinds
  assert.equal(score('Tr1cky-Horse'), 3);              // 12 chars, four kinds
  assert.equal(score('Blue#Fox7'), 2);                 // 9 chars, four kinds -> Fair
  assert.equal(score('twelve letters'), 2);            // 12+ chars, any kind -> Fair
  assert.equal(score('Correct-Horse-Battery-9'), 4);   // 16+ with a mix -> Strong
});

test('labels line up with scores', () => {
  assert.deepEqual(STRENGTH_LABELS, ['', 'Weak', 'Fair', 'Good', 'Strong']);
  assert.equal(passwordStrength('Correct-Horse-Battery-9').label, 'Strong');
});

test('common passwords, repeats and sequences stay Weak however long', () => {
  for (const pw of ['password', 'Password1!', 'P@ssw0rd', 'qwertyuiop', '12345678', 'aaaaaaaaaaaaaaaa', 'abcabcabcabc', 'Monarch2026', 'MonarchJobs123!']) {
    const r = passwordStrength(pw);
    assert.equal(r.score, 1, pw);
    assert.equal(r.flagged, true, pw);
  }
});

test('a password containing the person\'s name or email is held Weak', () => {
  const ctx = ['sam.rivera@example.com', 'Sam Rivera'];
  assert.equal(score('Rivera-Plumbing-88', ctx), 1);
  assert.equal(score('Rivera-Plumbing-88'), 4);
  assert.equal(score('Tr1cky-Horse-Wins', ctx), 4);
  // very short pieces of a name are ignored
  assert.equal(score('Sam-loves-tacos-99!', ['Sam']), 4);
});

test('a tip is offered until the password is Strong', () => {
  assert.match(passwordStrength('Ab1!').tip, /at least 8/i);
  assert.match(passwordStrength('Blue#Fox7').tip, /longer/i);
  assert.doesNotMatch(passwordStrength('Blue#Fox7').tip, /mix/i); // already mixed
  assert.match(passwordStrength('bluefoxrunsfast').tip, /mix/i);
  assert.match(passwordStrength('password').tip, /common/i);
  assert.equal(passwordStrength('Correct-Horse-Battery-9').tip, '');
});
