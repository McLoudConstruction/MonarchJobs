import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveLines, tierTotals, validateChoice, kindFields, lineKind, hasTiers, currentTotals, choiceFromEstimate } from '../lib/estimateOptions.js';
import { estimateSnapshot, sameSnapshot, estimateTotals } from '../lib/estimate.js';

const L = (id, price, extra = {}) => ({ id, description: id, unit: 'flat', quantity: 1, unit_price: price, tier: null, optional: false, accepted: false, ...extra });
const lines = [
  L('base', 100),
  L('g', 50, { tier: 'good' }), L('b', 120, { tier: 'better' }), L('x', 200, { tier: 'best' }),
  L('prot', 30, { optional: true }), L('odor', 25, { optional: true }),
];

test('line types map to fields and back', () => {
  assert.deepEqual(kindFields('optional'), { tier: null, optional: true });
  assert.deepEqual(kindFields('better'), { tier: 'better', optional: false });
  assert.deepEqual(kindFields('included'), { tier: null, optional: false });
  assert.equal(lineKind(lines[4]), 'optional');
  assert.equal(lineKind(lines[2]), 'better');
  assert.equal(lineKind(lines[0]), 'included');
});

test('only the chosen tier and the ticked add-ons count', () => {
  const ids = (c) => effectiveLines(lines, c).map((l) => l.id);
  assert.deepEqual(ids({ tier: 'better', picks: ['odor'] }), ['base', 'b', 'odor']);
  assert.deepEqual(ids({ tier: null, picks: [] }), ['base']);
  assert.deepEqual(ids({ tier: 'good', picks: ['prot', 'odor'] }), ['base', 'g', 'prot', 'odor']);
});

test('each tier has its own total, with the job minimum applied', () => {
  const t = tierTotals(lines, 0);
  assert.equal(t.good.totalCents, 15000);
  assert.equal(t.better.totalCents, 22000);
  assert.equal(t.best.totalCents, 30000);
  assert.equal(tierTotals(lines, 250).good.totalCents, 25000);
  assert.deepEqual(Object.keys(tierTotals([L('a', 10)], 0)), []);
});

test('the customer choice is checked', () => {
  assert.ok(validateChoice(lines, { tier: 'nope', picks: [] }).error);
  assert.ok(validateChoice(lines, { picks: [] }).error, 'a quote with tiers needs one picked');
  assert.ok(validateChoice(lines, { tier: 'good', picks: ['base'] }).error, 'a required line is not an add-on');
  assert.ok(validateChoice(lines, { tier: 'good', picks: ['made-up'] }).error);
  assert.deepEqual(validateChoice(lines, { tier: 'good', picks: ['prot', 'prot'] }).choice, { tier: 'good', picks: ['prot'] });
  const plain = [L('a', 10), L('o', 5, { optional: true })];
  assert.equal(hasTiers(plain), false);
  assert.deepEqual(validateChoice(plain, { tier: 'best', picks: ['o'] }).choice, { tier: null, picks: ['o'] });
});

test('office total: included lines before approval, the customer choice after', () => {
  const est = { status: 'sent', minimum_charge: 0 };
  assert.equal(currentTotals(est, lines).totalCents, 10000);
  const done = { status: 'approved', chosen_tier: 'better', minimum_charge: 0 };
  const accepted = lines.map((l) => (l.id === 'odor' ? { ...l, accepted: true } : l));
  assert.deepEqual(choiceFromEstimate(done, accepted), { tier: 'better', picks: ['odor'] });
  assert.equal(currentTotals(done, accepted).totalCents, 10000 + 12000 + 2500);
});

test('the signed snapshot is the chosen lines, so later edits to other options do not flag it', () => {
  const choice = { tier: 'good', picks: ['prot'] };
  const signed = estimateSnapshot(effectiveLines(lines, choice), 0);
  assert.equal(estimateTotals(effectiveLines(lines, choice), 0).totalCents, 18000);
  // the office edits the Best option's price: the customer's signed version is unaffected
  const edited = lines.map((l) => (l.id === 'x' ? { ...l, unit_price: 999 } : l));
  assert.equal(sameSnapshot(signed, estimateSnapshot(effectiveLines(edited, choice), 0)), true);
  // but changing a line they chose is flagged
  const edited2 = lines.map((l) => (l.id === 'g' ? { ...l, unit_price: 60 } : l));
  assert.equal(sameSnapshot(signed, estimateSnapshot(effectiveLines(edited2, choice), 0)), false);
});
