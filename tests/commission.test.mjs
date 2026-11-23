import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRule, shares, commissionReport, commissionCsv } from '../lib/commission.js';

const people = [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Sam' }, { id: 'c', name: 'Jo' }];

test('a rule needs a basis and a percent from 0 to 100 with at most two decimals', () => {
  assert.deepEqual(cleanRule({ basis: 'paid', percent: '5' }), { value: { basis: 'paid', percent: 5 } });
  assert.deepEqual(cleanRule({ basis: 'margin', percent: '7.5%' }), { value: { basis: 'margin', percent: 7.5 } });
  assert.deepEqual(cleanRule({ basis: 'margin', percent: 12.25 }), { value: { basis: 'margin', percent: 12.25 } });
  assert.ok(cleanRule({ basis: 'paid', percent: '101' }).error);
  assert.ok(cleanRule({ basis: 'paid', percent: '-1' }).error);
  assert.ok(cleanRule({ basis: 'paid', percent: '5.555' }).error);
  assert.ok(cleanRule({ basis: 'paid', percent: 'abc' }).error);
  assert.ok(cleanRule({ basis: 'salary', percent: '5' }).error);
  assert.deepEqual(cleanRule({ basis: 'paid', percent: '0' }), { value: { basis: 'paid', percent: 0 } });
});

test('a job is shared by the minutes each person clocked', () => {
  assert.deepEqual(shares({ a: 180, b: 60 }), [{ staffId: 'a', share: 0.75 }, { staffId: 'b', share: 0.25 }]);
  assert.deepEqual(shares({ a: 0, b: 60 }), [{ staffId: 'b', share: 1 }]);
  assert.deepEqual(shares({}), []);
  assert.deepEqual(shares(null), []);
});

test('paid-invoice commission is the percent of money received, shared by minutes', () => {
  const r = commissionReport({
    people, rules: { a: { basis: 'paid', percent: 10 }, b: { basis: 'paid', percent: 5 } },
    jobs: [{ jobId: 'j1', number: 101, customer: 'Lee', byStaff: { a: 180, b: 60 }, paidCents: 100000, marginCents: 40000, finishedInPeriod: true }],
  });
  const a = r.people.find((p) => p.staffId === 'a'); const b = r.people.find((p) => p.staffId === 'b');
  assert.equal(a.basisCents, 75000); assert.equal(a.commissionCents, 7500);
  assert.equal(b.basisCents, 25000); assert.equal(b.commissionCents, 1250);
  assert.equal(r.totalCents, 8750);
  assert.equal(a.lines[0].sharePct, 75);
});

test('margin commission only counts jobs finished in the period and never goes below zero', () => {
  const r = commissionReport({
    people, rules: { a: { basis: 'margin', percent: 20 } },
    jobs: [
      { jobId: 'j1', number: 1, byStaff: { a: 60 }, paidCents: 50000, marginCents: 30000, finishedInPeriod: true },
      { jobId: 'j2', number: 2, byStaff: { a: 60 }, paidCents: 50000, marginCents: -10000, finishedInPeriod: true },   // a loss
      { jobId: 'j3', number: 3, byStaff: { a: 60 }, paidCents: 50000, marginCents: null, finishedInPeriod: true },     // no price
      { jobId: 'j4', number: 4, byStaff: { a: 60 }, paidCents: 50000, marginCents: null, finishedInPeriod: false },    // paid this period, finished earlier
    ],
  });
  assert.equal(r.people[0].commissionCents, 6000);
  assert.equal(r.people[0].lines.length, 1);
  assert.equal(r.noMargin, 1);
});

test('people with no rule earn nothing, and money on a job nobody clocked is reported', () => {
  const r = commissionReport({
    people, rules: { a: { basis: 'paid', percent: 10 } },
    jobs: [
      { jobId: 'j1', number: 1, byStaff: { a: 60, c: 60 }, paidCents: 20000, marginCents: 0, finishedInPeriod: false },
      { jobId: 'j2', number: 2, customer: 'Ng', byStaff: {}, paidCents: 30000, marginCents: 0, finishedInPeriod: false },
    ],
  });
  assert.deepEqual(r.people.map((p) => p.name), ['Alex']);
  assert.equal(r.people[0].commissionCents, 1000);                      // half of 20,000 at 10%
  assert.deepEqual(r.unassigned, [{ jobId: 'j2', number: 2, customer: 'Ng', basisCents: 30000 }]);
});

test('a former team member with a saved rule still appears, and a rule of 0 percent pays nothing', () => {
  const r = commissionReport({ people, rules: { z: { basis: 'paid', percent: 10 }, a: { basis: 'paid', percent: 0 } }, jobs: [{ jobId: 'j', byStaff: { z: 60, a: 60 }, paidCents: 10000, finishedInPeriod: false }] });
  assert.equal(r.people.find((p) => p.staffId === 'z').name, 'Former team member');
  assert.equal(r.people.find((p) => p.staffId === 'z').commissionCents, 500);
  assert.equal(r.people.find((p) => p.staffId === 'a').commissionCents, 0);
});

test('refunds bigger than payments never make a negative commission', () => {
  const r = commissionReport({ people, rules: { a: { basis: 'paid', percent: 10 } }, jobs: [{ jobId: 'j', byStaff: { a: 60 }, paidCents: -5000, finishedInPeriod: false }] });
  assert.equal(r.totalCents, 0);
});

test('the commission CSV has a line per job and a total per person', () => {
  const r = commissionReport({ people, rules: { a: { basis: 'paid', percent: 10 } }, jobs: [{ jobId: 'j1', number: 101, customer: 'Lee, Pat', byStaff: { a: 60 }, paidCents: 100000, finishedInPeriod: false }] });
  const lines = commissionCsv(r, 'Last 30 days').split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[1], 'Alex,10% of paid invoices,#101,"Lee, Pat",100%,1000.00,100.00,Last 30 days');
  assert.equal(lines[2], 'Alex,10% of paid invoices,Total,,,1000.00,100.00,Last 30 days');
});
