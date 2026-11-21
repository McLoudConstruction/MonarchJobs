import test from 'node:test';
import assert from 'node:assert/strict';
import { normStreet, duplicateArgs, duplicateKey, reasonText, bannerText, visibleMatches } from '../lib/duplicateCheck.js';

// These pairs were produced by running public.norm_street_full (migration 040) on a scratch Postgres.
// If the SQL or the JS changes, this table is what keeps the two in agreement.
const FROM_SQL = [
  ['123 N. Main Street', '123nmainst'], ['123 north main st', '123nmainst'], ['45 West Lane', '45wln'],
  ['500 Oak Avenue, Apt 4', '500oakaveapt4'], ['PO Box 12', 'pobox12'], ['1600 Pennsylvania Ave NW', '1600pennsylvaniaavenw'],
  ['77 Eastwood Drive', '77eastwooddr'], ['12 Streeter Rd', '12streeterrd'], ['9 Court Place', '9ctpl'],
  ['Boulevard Circle 1', 'blvdcir1'], ['', ''], ['  ', ''],
];
test('street text is normalized exactly as the database does it', () => {
  for (const [input, expected] of FROM_SQL) assert.equal(normStreet(input), expected, JSON.stringify(input));
  assert.equal(normStreet('123 N. Main Street'), normStreet('123 north main st'));
});

test('nothing is asked until enough is typed', () => {
  assert.equal(duplicateArgs({}), null);
  assert.equal(duplicateArgs(null), null);
  assert.equal(duplicateArgs({ phone: '(314) 555' }), null, 'a partial phone');
  assert.equal(duplicateArgs({ email: 'jane@' }), null, 'a partial email');
  assert.equal(duplicateArgs({ street: '12 A', zip: '63101' }), null, 'a street that is too short');
  assert.equal(duplicateArgs({ street: '123 Main St' }), null, 'a street without a zip or city is too loose');
});

test('a full phone, a whole email, or a street with a zip or city is enough', () => {
  assert.equal(duplicateArgs({ phone: '(314) 555-0101' }).p_phone, '3145550101');
  assert.equal(duplicateArgs({ email: ' jane@example.com ' }).p_email, 'jane@example.com');
  assert.equal(duplicateArgs({ street: '123 Main St', zip: '63101-1234' }).p_street, '123 Main St');
  assert.equal(duplicateArgs({ street: '123 Main St', zip: '63101-1234' }).p_zip, '63101');
  assert.equal(duplicateArgs({ street: '123 Main St', city: 'St Louis' }).p_street, '123 Main St');
});

test('arguments carry only what is worth matching on', () => {
  const a = duplicateArgs({ phone: '555', email: 'jane@example.com', street: '12', unit: ' 4B ', city: 'St Louis', zip: '63101' });
  assert.equal(a.p_phone, '');
  assert.equal(a.p_street, '');
  assert.equal(a.p_unit, '4B');
  assert.equal(a.p_email, 'jane@example.com');
  assert.deepEqual(Object.keys(a).sort(), ['p_city', 'p_email', 'p_phone', 'p_street', 'p_unit', 'p_zip']);
});

test('the same typing gives the same key, so the screen does not ask twice', () => {
  const a = duplicateKey(duplicateArgs({ phone: '3145550101', first_name: 'Jane' }));
  const b = duplicateKey(duplicateArgs({ phone: '(314) 555-0101', first_name: 'Janet' }));
  assert.equal(a, b);
  assert.equal(duplicateKey(null), '');
});

test('the banner says why, in plain words', () => {
  assert.equal(reasonText({ same_phone: true }), 'Same phone number');
  assert.equal(reasonText({ same_phone: true, same_address: true }), 'Same phone number and address');
  assert.equal(reasonText({ same_phone: true, same_email: true, same_address: true }), 'Same phone number, email and address');
  assert.equal(reasonText({}), '');
  assert.equal(bannerText({ kind: 'customer', display_name: 'Jane Smith', same_email: true }), 'Jane Smith is already a customer. Same email.');
  assert.equal(bannerText({ kind: 'lead', display_name: 'Carl Dee', same_phone: true }), 'Open lead for Carl Dee. Same phone number.');
});

test('"Not the same" hides just that match', () => {
  const ms = [{ kind: 'customer', id: 'a' }, { kind: 'lead', id: 'a' }, { kind: 'customer', id: 'b' }];
  assert.deepEqual(visibleMatches(ms, new Set(['customer:a'])).map((m) => `${m.kind}:${m.id}`), ['lead:a', 'customer:b']);
  assert.equal(visibleMatches(null).length, 0);
});
