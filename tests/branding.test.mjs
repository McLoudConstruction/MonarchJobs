import test from 'node:test';
import assert from 'node:assert/strict';
import { sniffImageType, logoUrl } from '../lib/branding.js';

test('sniffImageType recognises PNG, JPEG and WebP by their first bytes', () => {
  assert.equal(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), 'image/png');
  assert.equal(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg');
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(sniffImageType(webp), 'image/webp');
});

test('sniffImageType rejects SVG, text and empty files even if renamed .png', () => {
  assert.equal(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImageType(new TextEncoder().encode('hello world, not an image')), null);
  assert.equal(sniffImageType(new Uint8Array(0)), null);
});

test('logoUrl builds the public storage URL and returns null without a path', () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
  assert.equal(logoUrl('logo-1.png'), 'https://abc.supabase.co/storage/v1/object/public/branding/logo-1.png');
  assert.equal(logoUrl(null), null);
  assert.equal(logoUrl(''), null);
});
