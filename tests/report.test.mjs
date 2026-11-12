import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlan, newRoom } from '../lib/sketch.js';
import { makeMoisture, makeReading } from '../lib/moisture.js';
import { buildReport, niceScale, renderMoistureReport } from '../lib/moistureReport.js';
import { PdfDoc, textWidth, wrapText, pdfClean } from '../lib/pdfDoc.js';

const by = { id: 'u1', name: 'Sam' };
function sample(n = 5) {
  const days = Array.from({ length: n }, (_, i) => ({ id: `d${i}`, date: `2026-11-${String(10 + i).padStart(2, '0')}` }));
  const plan = { ...emptyPlan(), rooms: [newRoom('Kitchen', 0, 0, 12, 10)], days, standards: { drywall: { val: 8, type: 'mc' } } };
  const P = (k, x, o, vals) => ({ ...makeMoisture(k, x, 3, o), readings: vals.map((v, i) => makeReading({ val: v, at: `2026-11-${10 + i}T15:00:00.000Z`, by, day: `d${i}` })) });
  plan.moisture = [P(1, 2, {}, [90, 40, 9, 7, 6]), P(2, 5, {}, [80, 60, 30, 12, 7]), P(3, 8, {}, [70, 20, 6, 9, 7])];
  return plan;
}

test('report: dry dates are the start of the final dry run, and the room is dry when all points are', () => {
  const r = buildReport(sample());
  const [a, b, c] = r.rows;
  assert.equal(a.state, 'dry'); assert.equal(a.dryDay.id, 'd3');   // 9 is over 8, 7 is dry
  assert.equal(b.dryDay.id, 'd4');
  assert.equal(c.dryDay.id, 'd4');                                 // dipped dry on d2, went back up, dry again from d4
  assert.equal(r.allDry, true);
  assert.equal(r.dryDay.id, 'd4');
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].allDry, true);
});

test('report: a still-wet point blocks the dry date, and standards say where the goal came from', () => {
  const plan = sample();
  plan.moisture[1].readings.pop();
  const r = buildReport(plan);
  assert.equal(r.allDry, false);
  assert.equal(r.rows[1].state, 'wet');
  assert.equal(r.rows[1].dryDay, null);
  assert.equal(r.standards[0].goal, 8);
  assert.equal(r.standards[0].source, 'entered');
});

test('report: air and dry standard points stay out of the moisture rows', () => {
  const plan = sample();
  plan.moisture.push({ ...makeMoisture(4, 4, 4, { kind: 'air' }), readings: [makeReading({ val: null, rh: 50, temp: 72, at: '2026-11-10T15:00:00.000Z', by, day: 'd0' })] });
  plan.moisture.push({ ...makeMoisture(5, 6, 6, { kind: 'standard' }), readings: [makeReading({ val: 8, at: '2026-11-10T15:00:00.000Z', by, day: 'd0' })] });
  const r = buildReport(plan);
  assert.equal(r.rows.length, 3);
  assert.equal(r.air.length, 1);
  assert.equal(r.air[0].gpp > 0, true);
  assert.equal(r.refs.length, 1);
  assert.equal(r.standards[0].source, 'measured');
});

test('report: an empty plan and a plan with no readings still render', () => {
  for (const plan of [emptyPlan(), { ...sample(), moisture: [] }]) {
    const t = Buffer.from(renderMoistureReport(plan, { title: 'x' })).toString('latin1');
    assert.ok(t.startsWith('%PDF-1.4')); assert.ok(t.trimEnd().endsWith('%%EOF'));
  }
});

test('report pdf: valid xref offsets, page count, footer, text is escaped, many days split into tables', () => {
  const plan = sample(20);
  const bytes = renderMoistureReport(plan, { title: 'Oak (St) \\ job', planImage: { bytes: new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]), w: 800, h: 500 } });
  const txt = Buffer.from(bytes).toString('latin1');
  const pages = Number(/\/Count (\d+)/.exec(txt)[1]);
  assert.ok(pages >= 3);
  assert.match(txt, new RegExp(`Page ${pages} of ${pages}`));
  assert.match(txt, /Oak \\\(St\\\) \\\\ job/);
  assert.match(txt, /\/Subtype \/Image/);
  const start = Number(/startxref\n(\d+)/.exec(txt)[1]);
  assert.ok(txt.slice(start).startsWith('xref'));
  const rows = [...txt.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  rows.forEach((off, i) => assert.ok(txt.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
});

test('pdf text helpers', () => {
  assert.equal(pdfClean('a’b — c↓ 中'), "a'b - c ");
  assert.ok(textWidth('Hello', 10) > 20 && textWidth('Hello', 10, true) > textWidth('Hello', 10));
  const lines = wrapText('one two three four five six seven', 60, 10);
  assert.ok(lines.length > 1 && lines.every((l) => textWidth(l, 10) <= 60.01));
  assert.equal(wrapText('Supercalifragilisticexpialidocious', 40, 10).every((l) => textWidth(l, 10) <= 40.01), true);
  const d = new PdfDoc(); d.addPage(); d.text(10, 10, 'x'); assert.ok(d.finish().length > 100);
});

test('niceScale gives round bounds', () => {
  assert.deepEqual(niceScale(99), { max: 100, step: 20 });
  assert.deepEqual(niceScale(12), { max: 15, step: 5 });
  assert.equal(niceScale(0).max >= 1, true);
});
