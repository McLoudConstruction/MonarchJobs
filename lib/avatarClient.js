'use client';
import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { AVATAR_BUCKET, AVATAR_SIDE, squareCrop } from '@/lib/avatar';

// Square 256 px JPEG of the middle of a picture, small enough to upload from any phone.
export async function shrinkToAvatar(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('That file is not a picture.');
  const bmp = await createImageBitmap(file);
  try {
    const { sx, sy, side } = squareCrop(bmp.width, bmp.height);
    const c = document.createElement('canvas');
    c.width = AVATAR_SIDE; c.height = AVATAR_SIDE;
    c.getContext('2d').drawImage(bmp, sx, sy, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) throw new Error('That picture could not be read.');
    return blob;
  } finally { bmp.close?.(); }
}

const cache = new Map(); // path -> { url, exp }
// Signed link for one profile picture path (or '' when there is none). Cached for 50 minutes.
export function useAvatarUrl(path) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(''); return undefined; }
    const c = cache.get(path);
    if (c && c.exp > Date.now()) { setUrl(c.url); return undefined; }
    getSupabase().storage.from(AVATAR_BUCKET).createSignedUrl(path, 3600).then(({ data }) => {
      if (!alive || !data?.signedUrl) return;
      cache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60000 });
      setUrl(data.signedUrl);
    }, () => {});
    return () => { alive = false; };
  }, [path]);
  return url;
}
