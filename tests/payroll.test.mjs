import test from 'node:test';
import assert from 'node:assert/strict';
import { periodFor, shiftPeriod, periodLabel, addDays, payrollSummary, payrollSummaryCsv, payrollDetailCsv, hoursText } from '../lib/payroll.js';
import { csvCell, toCsv } from '../lib/csv.js';

const at = (d, h, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-06:00`).toISOString(); // November: Central is UTC-6
const NOW = new Date(at('2026-11-30', 15));
let n = 0;
const shift = (staff, d, h1, h2, extra = {}) => ({ id: `s${++n}`, staff_id: staff, started_at: at(d, h1), ended_at: h2 == null ? null : at(d, h2), ...extra });
const job = (staff, d, h1, h2) => ({ id: `j${++n}`, staff_id: staff, job_id: 'job1', started_at: at(d, h1), ended_at: h2 == null ? null : at(d, h2) });
const people = [{ id: 'a', name: 'Alex Rivera', email: 'a@x.com', role: 'tech' }, { id: 'b', name: 'Sam Chen', email: 's@x.com', role: 'tech' }];

test('weekly and two-week periods count from the anchor Monday', () => {
  assert.deepEqual(periodFor('weekly', '2026-01-05', '2026-11-18'), { start: '2026-11-16', end: '2026-11-22', days: 7 });
  assert.deepEqual(periodFor('weekly', '2026-01-05', '2026-11-16'), { start: '2026-11-16', end: '2026-11-22', days: 7 });
  assert.deepEqual(periodFor('weekly', '2026-01-05', '2026-11-22'), { start: '2026-11-16', end: '2026-11-22', days: 7 });
  // 2026-01-05 + 46 weeks = 2026-11-23, so two-week periods start on 2026-11-09 and 2026-11-23
  assert.deepEqual(periodFor('biweekly', '2026-01-05', '2026-11-18'), { start: '2026-11-09', end: '2026-11-22', days: 14 });
  assert.deepEqual(periodFor('biweekly', '2026-01-05', '2026-11-23'), { start: '2026-11-23', end: '2026-12-06', days: 14 });
  // a pay cycle that starts on a Friday
  assert.deepEqual(periodFor('biweekly', '2026-11-06', '2026-11-19'), { start: '2026-11-06', end: '2026-11-19', days: 14 });
  assert.deepEqual(periodFor('biweekly', '2026-11-06', '2026-10-30'), { start: '2026-10-23', end: '2026-11-05', days: 14 });
});

test('twice-a-month and monthly periods follow the calendar, including February and leap years', () => {
  assert.deepEqual(periodFor('semimonthly', null, '2026-11-15'), { start: '2026-11-01', end: '2026-11-15', days: 15 });
  assert.deepEqual(periodFor('semimonthly', null, '2026-11-16'), { start: '2026-11-16', end: '2026-11-30', days: 15 });
  assert.deepEqual(periodFor('semimonthly', null, '2027-02-20'), { start: '2027-02-16', end: '2027-02-28', days: 13 });
  assert.equal(periodFor('semimonthly', null, '2028-02-20').end, '2028-02-29');
  assert.deepEqual(periodFor('monthly', null, '2026-12-31'), { start: '2026-12-01', end: '2026-12-31', days: 31 });
});

test('stepping to the earlier or later period lines up with no gap or overlap', () => {
  for (const kind of ['weekly', 'biweekly', 'semimonthly', 'monthly']) {
    let p = periodFor(kind, '2026-01-05', '2026-11-18');
    for (let i = 0; i < 6; i++) {
      const next = shiftPeriod(kind, '2026-01-05', p, 1);
      assert.equal(next.start, addDays(p.end, 1), `${kind} forward`);
      assert.equal(shiftPeriod(kind, '2026-01-05', next, -1).start, p.start, `${kind} back`);
      p = next;
    }
  }
  assert.equal(periodLabel({ start: '2026-11-09', end: '2026-11-22' }), 'Nov 9 to Nov 22, 2026');
});

test('hours come from the day clock when there is a shift, else from the job clock, never both', () => {
  const period = { start: '2026-11-09', end: '2026-11-22' };
  const s1 = shift('a', '2026-11-10', 8, 17);                 // 9 h shift
  const sessions = [job('a', '2026-11-10', 9, 15), job('a', '2026-11-11', 8, 12), job('b', '2026-11-12', 8, 12), job('b', '2026-11-13', 8, 10)];
  const breaks = [{ id: 'br', staff_id: 'a', shift_id: s1.id, started_at: at('2026-11-10', 12), ended_at: at('2026-11-10', 12, 30) }];
  const out = payrollSummary({ people, shifts: [s1], breaks, sessions, period, now: NOW });
  const a = out.find((p) => p.id === 'a'); const b = out.find((p) => p.id === 'b');
  assert.equal(hoursText(a.payMinutes), '12.50');   // 8.5 h worked on the 10th (break off) + 4 h job clock on the 11th
  assert.equal(a.source, 'mixed');
  assert.equal(a.daysWorked, 2);
  assert.equal(hoursText(b.payMinutes), '6.00');    // job clock only
  assert.equal(b.source, 'job clock');
});

test('time outside the period, removed entries and people with no time are left out', () => {
  const period = { start: '2026-11-09', end: '2026-11-22' };
  const out = payrollSummary({
    people, period, now: NOW,
    shifts: [shift('a', '2026-11-08', 8, 16), shift('a', '2026-11-23', 8, 16), { ...shift('a', '2026-11-12', 8, 16), voided_at: at('2026-11-12', 17) }],
    breaks: [], sessions: [],
  });
  assert.equal(out.length, 0);
});

test('a clock still running is flagged, and a change after the fact is noted', () => {
  const period = { start: '2026-11-23', end: '2026-12-06' };
  const open = shift('a', '2026-11-30', 8, null);
  const edited = shift('b', '2026-11-24', 8, 16, { edited_at: at('2026-11-25', 9) });
  const out = payrollSummary({ people, shifts: [open, edited], breaks: [], sessions: [], period, now: NOW });
  assert.equal(out.find((p) => p.id === 'a').running, true);
  assert.equal(hoursText(out.find((p) => p.id === 'a').payMinutes), '7.00'); // counted up to now (3 pm)
  const b = out.find((p) => p.id === 'b');
  assert.equal(b.running, false);
  assert.ok(b.checks >= 1);
  assert.ok(b.days[0].notes.includes('Changed after the fact'));
});

test('a shift that crosses midnight counts on the day it started', () => {
  const period = { start: '2026-11-09', end: '2026-11-22' };
  const s = { id: 'x', staff_id: 'a', started_at: at('2026-11-22', 22), ended_at: at('2026-11-23', 4) };
  const out = payrollSummary({ people, shifts: [s], breaks: [], sessions: [], period, now: NOW });
  assert.equal(out[0].days[0].date, '2026-11-22');
  assert.equal(hoursText(out[0].payMinutes), '6.00');
});

test('the CSV has one line per person (summary) and one per day (detail), with decimal hours', () => {
  const period = { start: '2026-11-09', end: '2026-11-22' };
  const out = payrollSummary({ people, shifts: [shift('a', '2026-11-10', 8, 16, { id: 'q' })], breaks: [], sessions: [job('b', '2026-11-11', 8, 10)], period, now: NOW });
  const summary = payrollSummaryCsv(out, period).split('\r\n');
  assert.equal(summary[0], 'Employee,Email,Pay period start,Pay period end,Total hours,Day clock hours,Job clock hours,Days worked,Hours from,Needs a check');
  assert.equal(summary.length, 3);
  assert.equal(summary[1], 'Alex Rivera,a@x.com,2026-11-09,2026-11-22,8.00,8.00,0.00,1,day clock,');
  assert.equal(summary[2], 'Sam Chen,s@x.com,2026-11-09,2026-11-22,2.00,0.00,2.00,1,job clock,');
  const detail = payrollDetailCsv(out, period).split('\r\n');
  assert.equal(detail.length, 3);
  assert.match(detail[1], /^Alex Rivera,2026-11-10,8\.00,day clock/);
});

test('payroll files carry no pay rates and no job or customer names', () => {
  const period = { start: '2026-11-09', end: '2026-11-22' };
  const out = payrollSummary({ people, shifts: [shift('a', '2026-11-10', 8, 16)], breaks: [], sessions: [job('a', '2026-11-10', 9, 11)], period, now: NOW });
  const text = payrollSummaryCsv(out, period) + payrollDetailCsv(out, period);
  assert.doesNotMatch(text, /rate|\$|job1/i);
});

test('spreadsheet formulas typed into a name cannot run', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('Lee, Pat'), '"Lee, Pat"');
  assert.equal(csvCell(null), '');
  assert.equal(toCsv([['a', 'b'], [1, 'c,d']]), 'a,b\r\n1,"c,d"');
});
