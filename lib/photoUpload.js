// Browser-side photo handling: shrink a phone photo, upload it to the private bucket, add the row.
// A 12-megapixel phone photo is about 4 MB; resized to 2000 px it is about 0.5 MB, which keeps
// uploads quick on a cellular connection and well under the server's request size limits (the
// browser uploads straight to storage, not through our server).
import { PHOTO_BUCKET, photoPaths, takenAtFor, fitWithin } from '@/lib/jobDocs';

export const FULL_MAX = 2000;
export const THUMB_MAX = 420;
export const MAX_INPUT_BYTES = 40 * 1024 * 1024;

async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close?.() };
    } catch { /* fall through to an <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('This file could not be read as a picture.'));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toJpeg(source, width, height, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // a PNG with transparency becomes white, not black
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the picture.'))), 'image/jpeg', quality);
  });
}

export async function prepareImage(file) {
  if (!file || !/^image\//.test(file.type || 'image/jpeg')) throw new Error('That file is not a picture.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('That picture is larger than 40 MB.');
  const img = await decode(file);
  try {
    const full = fitWithin(img.width, img.height, FULL_MAX);
    const thumb = fitWithin(img.width, img.height, THUMB_MAX);
    const [fullBlob, thumbBlob] = await Promise.all([
      toJpeg(img.source, full.width, full.height, 0.82),
      toJpeg(img.source, thumb.width, thumb.height, 0.7),
    ]);
    return { fullBlob, thumbBlob, width: full.width, height: full.height };
  } finally {
    img.close();
  }
}

const isDuplicate = (err) => /already exists|duplicate/i.test(err?.message || '') || String(err?.statusCode) === '409';

// Uploads one picture and adds its job_photos row. Returns the row.
// A retry with the same photoId is safe: files that are already there are accepted.
export async function uploadJobPhoto({
  sb, jobId, file, kind = 'during', caption = '', sketchId = null, roomKey = null,
  derivedFrom = null, takenAt = null, photoId = null,
}) {
  const id = photoId || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : null);
  if (!id) throw new Error('This browser cannot upload pictures.');
  const paths = photoPaths(jobId, id);
  const { fullBlob, thumbBlob, width, height } = await prepareImage(file);
  const opts = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };

  const up1 = await sb.storage.from(PHOTO_BUCKET).upload(paths.full, fullBlob, opts);
  if (up1.error && !isDuplicate(up1.error)) throw new Error(`Upload failed: ${up1.error.message}`);
  const up2 = await sb.storage.from(PHOTO_BUCKET).upload(paths.thumb, thumbBlob, opts);
  if (up2.error && !isDuplicate(up2.error)) throw new Error(`Upload failed: ${up2.error.message}`);

  const row = {
    id, job_id: jobId, kind, caption, storage_path: paths.full, thumb_path: paths.thumb,
    width, height, bytes: fullBlob.size, sketch_id: sketchId, room_key: roomKey, derived_from: derivedFrom,
    taken_at: takenAt || takenAtFor(file.lastModified),
  };
  const { data, error } = await sb.from('job_photos').insert(row).select('*').single();
  if (error) {
    if (/duplicate key/i.test(error.message)) {
      const { data: existing } = await sb.from('job_photos').select('*').eq('id', id).maybeSingle();
      if (existing) return existing;
    }
    throw new Error(`Could not save the photo: ${error.message}`);
  }
  return data;
}
