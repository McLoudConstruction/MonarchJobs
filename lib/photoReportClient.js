'use client';
// Browser side of the photo reports: fetch each picture from the private bucket, shrink it, and hand back JPEG bytes the
// PDF can hold. Photos are shrunk to REPORT_PX on the long side so a report of a hundred pictures stays a sensible size.
import { signPaths } from './useSignedUrls';

export const REPORT_PX = 1100;
const QUALITY = 0.8;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('A photo could not be read.'));
    img.src = url;
  });
}

async function toJpeg(blob) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    const k = Math.min(1, REPORT_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; // a transparent PNG would turn black as a JPEG otherwise
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', QUALITY));
    if (!out) throw new Error('A photo could not be converted.');
    return { bytes: new Uint8Array(await out.arrayBuffer()), w, h };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// photos: job_photos rows. Returns a Map of photo id -> { bytes, w, h } for every one that could be read, plus the ids that
// could not. onProgress(done, total) is called as each finishes. Four are fetched at a time.
export async function fetchReportPhotos(photos, onProgress = () => {}) {
  const urls = await signPaths(photos.map((p) => p.storage_path));
  const out = new Map();
  const failed = [];
  let done = 0;
  let next = 0;
  async function worker() {
    while (next < photos.length) {
      const p = photos[next++];
      try {
        const url = urls[p.storage_path];
        if (!url) throw new Error('no link');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        out.set(p.id, await toJpeg(await res.blob()));
      } catch {
        failed.push(p.id);
      }
      done += 1;
      onProgress(done, photos.length);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return { images: out, failed };
}

export function downloadBytes(bytes, filename, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeName = (s) => String(s || 'job').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'job';
