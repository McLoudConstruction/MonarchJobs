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
