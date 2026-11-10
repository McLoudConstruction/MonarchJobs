import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRealName, staffName, displayNameFor, initialsFor } from '../lib/userDisplay.js';

test('hasRealName rejects blank and email-looking values', () => {
  assert.equal(hasRealName('Stachys McLoud'), true);
  assert.equal(hasRealName(''), false);
  assert.equal(hasRealName(null), false);
  assert.equal(hasRealName('a@b.com'), false);
});

test('staffName prefers the saved name and never shows a raw email when it can be tidied', () => {
  assert.equal(staffName({ full_name: 'Pat Lee', email: 'pat.lee@x.com' }), 'Pat Lee');
  assert.equal(staffName({ full_name: '', email: 'pat.lee@x.com' }), 'Pat Lee');
  assert.equal(staffName(null), '');
});

test('initials come from the name', () => {
  assert.equal(initialsFor('Mary Ann Smith', 'x@y.com'), 'MS');
  assert.equal(displayNameFor('  Pat   Lee ', 'x@y.com'), 'Pat Lee');
});
