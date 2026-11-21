// Profile pictures. Pure helpers; the upload route and the account menu share them.
export const AVATAR_BUCKET = 'profile-photos';
export const AVATAR_MAX_BYTES = 1024 * 1024;
export const AVATAR_SIDE = 256; // pixels, square
export const AVATAR_TYPES = ['image/jpeg', 'image/webp', 'image/png'];

export const avatarPathFor = (staffId, uuid) => `${staffId}/${uuid}.jpg`;
export const avatarBelongsTo = (path, staffId) => typeof path === 'string' && !!staffId && path.startsWith(`${staffId}/`) && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i.test(path);

// The server's check on an uploaded picture. Returns an error sentence, or null when it is fine.
export function checkAvatarUpload({ size, type }) {
  if (!size) return 'The picture did not come through. Try again.';
  if (!AVATAR_TYPES.includes(type)) return 'Use a JPEG, PNG or WebP picture.';
  if (size > AVATAR_MAX_BYTES) return 'That picture is too large. Pick a smaller one.';
  return null;
}

// Where to crop a square out of a picture: the middle, the full short side. Returns { sx, sy, side }.
export function squareCrop(width, height) {
  const side = Math.max(1, Math.min(width, height));
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}
