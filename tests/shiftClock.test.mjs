import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, weekStartKey, weekKeys, addDaysKey, dayStartInstant, shiftTotals, shiftFlags, dayRows, validateShiftEdit, shiftsCsv, hmText, hmWords, hoursText } from '../lib/shiftClock.js';

const at = (d, h, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-06:00`).toISOString(); // November: Central is UTC-6
const NOW = new Date(at('2026-11-18', 15));
let n = 0;
const shift = (d, h1, h2, extra = {}) => ({ id: `s${++n}`, started_at: at(d, h1), ended_at: h2 == null ? null : at(d, h2), ...extra });
const brk = (s, h1, m1, h2, m2) => ({ id: `b${++n}`, shift_id: s.id, started_at: at(dayKey(s.started_at), h1, m1), ended_at: h2 == null ? null : at(dayKey(s.started_at), h2, m2) });
const job = (d, h1, h2) => ({ id: `j${++n}`, started_at: at(d, h1), ended_at: h2 == null ? null : at(d, h2) });

test('days and weeks use the shop time zone', () => {
  assert.equal(dayKey('2026-11-18T03:00:00Z'), '2026-11-17'); // 9 pm the evening before in Central
  assert.equal(weekStartKey('2026-11-18'), '2026-11-16'); // Wednesday -> Monday
  assert.equal(weekStartKey('2026-11-22'), '2026-11-16'); // Sunday belongs to the week before
  assert.equal(weekKeys('2026-11-16')[6], '2026-11-22');
  assert.equal(addDaysKey('2026-12-31', 1), '2027-01-01');
  assert.equal(dayStartInstant('2026-11-18').toISOString(), '2026-11-18T06:00:00.000Z');
  assert.equal(dayStartInstant('2026-07-04').toISOString(), '2026-07-04T05:00:00.000Z'); // daylight time
});

test('totals take breaks off and ignore voided breaks', () => {
  const s = shift('2026-11-17', 8, 17);
  const b1 = brk(s, 12, 0, 12, 30);
  const b2 = { ...brk(s, 15, 0, 15, 15), voided_at: at('2026-11-17', 16) };
  assert.deepEqual(shiftTotals(s, [b1, b2]), { gross: 540, breakMinutes: 30, net: 510 });
  const open = shift('2026-11-18', 8, null);
  assert.equal(shiftTotals(open, [], NOW).gross, 420);
  assert.equal(hmText(125), '2:05'); assert.equal(hmWords(485), '8 h 05 min'); assert.equal(hoursText(510), '8.50');
});

test('a normal day has no flags', () => {
  const s = shift('2026-11-17', 8, 17);
  const flags = shiftFlags({ shifts: [s], breaks: [brk(s, 12, 0, 12, 30)], sessions: [job('2026-11-17', 9, 11), job('2026-11-17', 13, 16)], now: NOW });
  assert.deepEqual(flags, []);
});

test('forgotten clock out, long shift, no break, long break', () => {
  const old = shift('2026-11-16', 8, null);
  assert.equal(shiftFlags({ shifts: [old], breaks: [], sessions: [], now: NOW })[0].key, 'still_open');
  const today = shift('2026-11-18', 8, null); // running today: fine
  assert.deepEqual(shiftFlags({ shifts: [today], breaks: [], sessions: [], now: NOW }).filter((f) => f.key === 'still_open'), []);
  const long = shift('2026-11-17', 5, 20);
  assert.ok(shiftFlags({ shifts: [long], breaks: [], sessions: [], now: NOW }).some((f) => f.key === 'long_shift'));
  const eight = shift('2026-11-17', 8, 17);
  assert.ok(shiftFlags({ shifts: [eight], breaks: [], sessions: [], now: NOW }).some((f) => f.key === 'no_break' && f.level === 'info'));
  const lb = shiftFlags({ shifts: [eight], breaks: [brk(eight, 11, 0, 13, 0)], sessions: [], now: NOW });
  assert.ok(lb.some((f) => f.key === 'long_break'));
  assert.ok(!lb.some((f) => f.key === 'no_break'));
});

test('job time is checked against the shift', () => {
  const s = shift('2026-11-17', 9, 12);
  const outside = shiftFlags({ shifts: [s], breaks: [], sessions: [job('2026-11-17', 11, 14)], now: NOW });
  assert.ok(outside.some((f) => f.key === 'job_outside_shift' && /2 h 00 min/.test(f.text)));
  const noShift = shiftFlags({ shifts: [], breaks: [], sessions: [job('2026-11-17', 9, 11)], now: NOW });
  assert.equal(noShift[0].key, 'job_outside_shift');
  const full = shift('2026-11-17', 8, 17);
  const inBreak = shiftFlags({ shifts: [full], breaks: [brk(full, 12, 0, 13, 0)], sessions: [job('2026-11-17', 11, 14)], now: NOW });
  assert.ok(inBreak.some((f) => f.key === 'job_in_break'));
  const over = shiftFlags({ shifts: [shift('2026-11-17', 8, 10)], breaks: [], sessions: [job('2026-11-17', 8, 10), job('2026-11-17', 8, 10)], now: NOW });
  assert.ok(over.some((f) => f.key === 'job_over_shift'));
});

test('overlaps, open breaks and idle tech days', () => {
  const a = shift('2026-11-17', 8, 12); const b = shift('2026-11-17', 11, 15);
  assert.ok(shiftFlags({ shifts: [a, b], breaks: [], sessions: [], now: NOW }).some((f) => f.key === 'overlap'));
  const s = shift('2026-11-17', 8, 12);
  assert.ok(shiftFlags({ shifts: [s], breaks: [brk(s, 10, 0, null)], sessions: [], now: NOW }).some((f) => f.key === 'break_open'));
  assert.ok(shiftFlags({ shifts: [s], breaks: [], sessions: [], role: 'tech', now: NOW }).some((f) => f.key === 'no_job_time'));
  assert.ok(!shiftFlags({ shifts: [s], breaks: [], sessions: [], role: 'office', now: NOW }).some((f) => f.key === 'no_job_time'));
  const voided = { ...shift('2026-11-16', 8, null), voided_at: at('2026-11-16', 9) };
  assert.deepEqual(shiftFlags({ shifts: [voided], breaks: [], sessions: [], now: NOW }), []);
});

test('rows group by day, newest first, with totals and flags', () => {
  const a = shift('2026-11-16', 8, 16); const b = shift('2026-11-17', 8, 12);
  const rows = dayRows({ shifts: [a, b], breaks: [brk(a, 12, 0, 12, 30)], sessions: [job('2026-11-16', 9, 11)], now: NOW });
  assert.deepEqual(rows.map((r) => r.date), ['2026-11-17', '2026-11-16']);
  assert.equal(rows[1].netMinutes, 450); assert.equal(rows[1].breakMinutes, 30); assert.equal(rows[1].jobMinutes, 120);
});

test('revision requests are checked before the owner sees them', () => {
  const s = shift('2026-11-17', 8, 17);
  const good = { target: 'shift', shift: s, breaks: [], started_at: at('2026-11-17', 7, 45), ended_at: at('2026-11-17', 17), reason: 'Forgot to clock in' };
  assert.equal(validateShiftEdit(good, NOW).value.reason, 'Forgot to clock in');
  assert.match(validateShiftEdit({ ...good, reason: ' ' }, NOW).error, /why/);
  assert.match(validateShiftEdit({ ...good, ended_at: at('2026-11-17', 7) }, NOW).error, /after the start/);
  assert.match(validateShiftEdit({ ...good, started_at: at('2026-11-17', 8), ended_at: at('2026-11-17', 17) }, NOW).error, /same times/);
  assert.match(validateShiftEdit({ ...good, shift: { ...s, ended_at: null } }, NOW).error, /still clocked in/);
  assert.match(validateShiftEdit({ ...good, ended_at: at('2026-11-18', 20) }, NOW).error, /future/);
  const withBreak = brk(s, 8, 0, 8, 30);
  assert.match(validateShiftEdit({ ...good, breaks: [withBreak], started_at: at('2026-11-17', 9) }, NOW).error, /break falls outside/);
  assert.match(validateShiftEdit({ ...good, others: [shift('2026-11-17', 16, 19)] , ended_at: at('2026-11-17', 17, 30) }, NOW).error, /overlap/);
});

test('break and add requests have their own rules', () => {
  const s = shift('2026-11-17', 8, 17); const k = brk(s, 12, 0, 12, 30);
  const ok = validateShiftEdit({ target: 'break', shift: s, brk: k, breaks: [k], started_at: at('2026-11-17', 12), ended_at: at('2026-11-17', 13), reason: 'Long lunch' }, NOW);
  assert.ok(ok.value);
  assert.match(validateShiftEdit({ target: 'break', shift: s, brk: k, breaks: [k], started_at: at('2026-11-17', 7), ended_at: at('2026-11-17', 13), reason: 'x y z' }, NOW).error, /inside its shift/);
  const add = { target: 'add', others: [], started_at: at('2026-11-14', 8), ended_at: at('2026-11-14', 16), reason: 'Forgot my phone' };
  assert.ok(validateShiftEdit(add, NOW).value);
  assert.match(validateShiftEdit({ ...add, started_at: at('2026-10-01', 8), ended_at: at('2026-10-01', 16) }, NOW).error, /14 days/);
  assert.match(validateShiftEdit({ ...add, others: [shift('2026-11-14', 10, 12)] }, NOW).error, /overlap/);
  assert.match(validateShiftEdit({ ...add, started_at: at('2026-11-14', 8), ended_at: at('2026-11-15', 20) }, NOW).error, /24 hours/);
  assert.match(validateShiftEdit({ ...add, target: 'nope' }, NOW).error, /Unknown/);
});

test('the payroll CSV is safe to open in a spreadsheet', () => {
  const s = shift('2026-11-17', 8, 17, { edited_at: at('2026-11-17', 18) });
  const days = dayRows({ shifts: [s], breaks: [brk(s, 12, 0, 12, 30)], sessions: [job('2026-11-17', 9, 11)], now: NOW });
  const csv = shiftsCsv([{ name: '=HYPERLINK("x")', days }], NOW);
  const lines = csv.split('\n');
  assert.match(lines[0], /^Employee,Date,Clock in/);
  assert.ok(lines[1].startsWith('"\'=HYPERLINK(""x"")"'));
  assert.match(lines[1], /,30,8\.50,2\.00,Changed after the fact$/);
});
