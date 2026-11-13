import test from 'node:test';
import assert from 'node:assert/strict';
import { customerSearchArgs } from '../lib/customerSearch.js';

test('nothing is searched until enough has been typed', () => {
  assert.equal(customerSearchArgs({}), null);
  assert.equal(customerSearchArgs({ first_name: 'S' }), null);
  assert.equal(customerSearchArgs({ phone: '(81' }), null);
  assert.equal(customerSearchArgs({ email: 'a@' }), null);
});

test('first and last name are searched together, a company name on its own', () => {
  assert.deepEqual(customerSearchArgs({ first_name: 'Sam', last_name: 'Riv' }), { p_name: 'Sam Riv', p_phone: '', p_email: '' });
  assert.equal(customerSearchArgs({ last_name: 'Rivera' }).p_name, 'Rivera');
  assert.equal(customerSearchArgs({ first_name: 'Sam', company_name: 'Acme Lofts' }).p_name, 'Acme Lofts');
});

test('a phone is searched by its digits, however it was formatted', () => {
  assert.deepEqual(customerSearchArgs({ phone: '(816) 555' }), { p_name: '', p_phone: '816555', p_email: '' });
});

test('every filled field is sent, so any one of them can find the customer', () => {
  assert.deepEqual(
    customerSearchArgs({ first_name: 'Sam', phone: '8165551212', email: 'sam@x.com' }),
    { p_name: 'Sam', p_phone: '8165551212', p_email: 'sam@x.com' }
  );
});
