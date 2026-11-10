'use client';
import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { PHOTO_BUCKET } from '@/lib/jobDocs';

// Signed links for files in the private photo bucket. Links last an hour; they are cached in memory
// for 50 minutes so scrolling back to a tab does not ask for them again.
const TTL_MS = 50 * 60 * 1000;
const cache = new Map(); // path -> { url, exp }

const fresh = (path) => {
  const c = cache.get(path);
  return c && c.exp > Date.now() ? c.url : null;
};

export async function signPaths(paths) {
  const need = [...new Set(paths.filter(Boolean))].filter((p) => !fresh(p));
  if (need.length) {
    const { data } = await getSupabase().storage.from(PHOTO_BUCKET).createSignedUrls(need, 3600);
    for (const d of data || []) if (d.signedUrl && !d.error) cache.set(d.path, { url: d.signedUrl, exp: Date.now() + TTL_MS });
  }
  const out = {};
  for (const p of paths) if (p && fresh(p)) out[p] = fresh(p);
  return out;
}

export function useSignedUrls(paths) {
  const [urls, setUrls] = useState({});
  const key = paths.filter(Boolean).join('|');
  useEffect(() => {
    let alive = true;
    const list = key ? key.split('|') : [];
    if (!list.length) { setUrls({}); return undefined; }
    signPaths(list).then((m) => { if (alive) setUrls(m); }).catch(() => {});
    return () => { alive = false; };
  }, [key]);
  return urls;
}
