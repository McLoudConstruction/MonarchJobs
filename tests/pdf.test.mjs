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
