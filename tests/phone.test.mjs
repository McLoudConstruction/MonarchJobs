import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, displayPhone, telHref, toE164, digitsOnly } from '../lib/phone.js';

test('formats as the person types, one digit at a time', () => {
  const steps = ['8', '81', '816', '8165', '81655', '816555', '8165551', '81655512', '816555121', '8165551212'];
  assert.deepEqual(steps.map(formatPhone), [
    '(8', '(81', '(816', '(816) 5', '(816) 55', '(816) 555', '(816) 555-1', '(816) 555-12', '(816) 555-121', '(816) 555-1212',
  ]);
});

test('backspacing over the punctuation keeps working', () => {
  // the person deletes the last character of "(816) 5": the browser hands us "(816) "
  assert.equal(formatPhone('(816) '), '(816');
  assert.equal(formatPhone('(816'), '(816');
  assert.equal(formatPhone('(81'), '(81');
  assert.equal(formatPhone(''), '');
});

test('pasted numbers in any shape are cleaned up; extra digits are dropped', () => {
  assert.equal(formatPhone('+1 816-555-1212'), '(816) 555-1212');
  assert.equal(formatPhone('1 (816) 555.1212'), '(816) 555-1212');
  assert.equal(formatPhone('816555121299'), '(816) 555-1212');
  assert.equal(formatPhone('abc'), '');
});

test('a number that starts with 1 can still be typed', () => {
  assert.equal(formatPhone('1'), '(1');
  assert.equal(formatPhone('1555'), '(155) 5');
});

test('displayPhone formats complete numbers and leaves odd ones alone', () => {
  assert.equal(displayPhone('8165551212'), '(816) 555-1212');
  assert.equal(displayPhone('+1 816 555 1212'), '(816) 555-1212');
  assert.equal(displayPhone('816-555-1212 x4'), '816-555-1212 x4');
  assert.equal(displayPhone('555-1212'), '555-1212');
  assert.equal(displayPhone(''), '');
  assert.equal(displayPhone(null), '');
});

test('tel link and E.164', () => {
  assert.equal(telHref('(816) 555-1212'), 'tel:+18165551212');
  assert.equal(telHref(''), '');
  assert.equal(toE164('(816) 555-1212'), '+18165551212');
  assert.equal(toE164('1-816-555-1212'), '+18165551212');
  assert.equal(toE164('555-1212'), null);
  assert.equal(digitsOnly('(816) 555'), '816555');
});
