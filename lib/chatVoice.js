'use client';
import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { CHAT_VOICE_BUCKET } from '@/lib/chat';

// Signed links for voice notes in the private chat-voice bucket. Same idea as chat pictures: links last an hour and are kept
// in memory for 50 minutes.
const TTL_MS = 50 * 60 * 1000;
const cache = new Map(); // path -> { url, exp }
const fresh = (p) => { const c = cache.get(p); return c && c.exp > Date.now() ? c.url : null; };

export async function signVoicePaths(paths) {
  const need = [...new Set(paths.filter(Boolean))].filter((p) => !fresh(p));
  if (need.length) {
    const { data } = await getSupabase().storage.from(CHAT_VOICE_BUCKET).createSignedUrls(need, 3600);
    for (const d of data || []) if (d.signedUrl && !d.error) cache.set(d.path, { url: d.signedUrl, exp: Date.now() + TTL_MS });
  }
  const out = {};
  for (const p of paths) if (p && fresh(p)) out[p] = fresh(p);
  return out;
}

export function useChatVoiceUrls(paths) {
  const [urls, setUrls] = useState({});
  const key = paths.filter(Boolean).join('|');
  useEffect(() => {
    let alive = true;
    const list = key ? key.split('|') : [];
    if (!list.length) { setUrls({}); return undefined; }
    signVoicePaths(list).then((m) => { if (alive) setUrls(m); }).catch(() => {});
    return () => { alive = false; };
  }, [key]);
  return urls;
}
