import test from 'node:test';
import assert from 'node:assert/strict';
import { jpegToPdf } from '../lib/pdfImage.js';

test('jpegToPdf writes a valid single-page pdf with correct offsets', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const pdf = jpegToPdf(jpeg, 1600, 900, 'Kitchen (1st) \\ floor é');
  const txt = Buffer.from(pdf).toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4'));
  assert.ok(txt.trimEnd().endsWith('%%EOF'));
  assert.match(txt, /\/MediaBox \[0 0 792 612\]/); // wide picture gets a landscape page
  assert.match(txt, /\/Length 7 >>\nstream\n/);
  assert.match(txt, /Kitchen \\\(1st\\\) \\\\ floor  ?\) Tj|Kitchen \\\(1st\\\) \\\\ floor/);
  const start = Number(/startxref\n(\d+)/.exec(txt)[1]);
  assert.ok(txt.slice(start).startsWith('xref'));
  const rows = [...txt.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  rows.forEach((off, i) => assert.ok(txt.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
});

test('tall pictures get a portrait page', () => {
  const pdf = Buffer.from(jpegToPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 800, 1200)).toString('latin1');
  assert.match(pdf, /\/MediaBox \[0 0 612 792\]/);
});

import { fitView } from '../lib/sketch.js';
test('fitView keeps the plan inside the inset area', () => {
  const b = { minX: 0, minY: 0, maxX: 20, maxY: 10 };
  const v = fitView(b, 800, 500, 20, { top: 60, right: 50 });
  assert.ok(v.oy >= 60 + 20 - 1e-6);                       // top edge below the toolbar
  assert.ok(v.ox + 20 * v.scale <= 800 - 50 - 20 + 1e-6);  // right edge left of the rail
  const plain = fitView(b, 800, 500, 20);
  assert.ok(v.scale <= plain.scale);
});

import { placeGrowth, rectPts, affectedTotals, normalizePlan, newArea } from '../lib/sketch.js';
const room = { id: 'r', label: '', notes: '', pts: rectPts(0, 0, 12, 10) };
const plan0 = normalizePlan({ rooms: [room] });

test('growth: a line near a wall becomes a wall band along it', () => {
  const stroke = [[2, 0.5], [4, 0.4], [6, 0.6], [8, 0.5]];
  const g = placeGrowth(plan0, stroke);
  assert.deepEqual(g.surfaces, ['wall']);
  const ys = g.pts.map((p) => p[1]);
  assert.ok(Math.min(...ys) === 0 && Math.max(...ys) > 0 && Math.max(...ys) <= 0.6); // along the top wall, inside the room
  const area = newArea(g.pts, { kind: 'growth', surfaces: g.surfaces, smooth: g.smooth, height: 4 });
  const t = affectedTotals({ ...plan0, areas: [area] }).total.growth;
  assert.ok(Math.abs(t.wall - 6 * 4) < 1.5, `wall sq ft ${t.wall}`); // about 6 ft long x 4 ft high
  assert.equal(t.ceiling || 0, 0);
});

test('growth: a line near the right wall snaps there, not to the top', () => {
  const g = placeGrowth(plan0, [[11.6, 3], [11.7, 5], [11.5, 7]]);
  const xs = g.pts.map((p) => p[0]);
  assert.ok(Math.max(...xs) === 12 && Math.min(...xs) >= 11.4);
});

test('growth: a loop becomes a ceiling shape and is pulled inside a room', () => {
  const circle = (cx, cy, r) => Array.from({ length: 25 }, (_, i) => [cx + r * Math.cos((i / 24) * 2 * Math.PI), cy + r * Math.sin((i / 24) * 2 * Math.PI)]);
  const inside = placeGrowth(plan0, circle(6, 5, 2));
  assert.deepEqual(inside.surfaces, ['ceiling']);
  const cx = inside.pts.reduce((t, p) => t + p[0], 0) / inside.pts.length;
  assert.ok(Math.abs(cx - 6) < 0.2);
  const outside = placeGrowth(plan0, circle(16, 5, 2));
  const ox = outside.pts.reduce((t, p) => t + p[0], 0) / outside.pts.length;
  assert.ok(ox > 11 && ox < 12, `centre x ${ox}`);
});

test('growth: nothing to snap to without rooms', () => {
  assert.equal(placeGrowth(normalizePlan({}), [[0, 0], [3, 0]]), null);
});
