// Shared helpers for the business logo. Safe to import from browser and server code.

export const LOGO_BUCKET = 'branding';
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// Public URL of a stored logo, or null when none is set.
export function logoUrl(path) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!path || !base) return null;
  return `${base}/storage/v1/object/public/${LOGO_BUCKET}/${path}`;
}

// Works out the real image type from the first bytes of the file, so a renamed or mislabeled file
// is rejected. Returns 'image/png' | 'image/jpeg' | 'image/webp' | null. SVG is deliberately not
// accepted: an SVG can carry scripts.
export function sniffImageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
