'use client';
// Business settings the photo features need on the phone. Read from the server, kept on the phone for the next time
// there is no signal. If the migration that adds the setting has not been run yet, the answer is "off".
import { useEffect, useState } from 'react';
import { getSupabase } from './supabaseClient';
import { metaRead, metaWrite } from './offlineClient';

const KEY = 'photo-settings';
let memory = null;

export async function loadPhotoSettings() {
  try {
    const { data, error } = await getSupabase().from('settings').select('keep_original_photos').eq('id', 1).maybeSingle();
    if (!error && data) {
      memory = { keepOriginals: !!data.keep_original_photos };
      metaWrite(KEY, memory);
      return memory;
    }
  } catch { /* no signal: use the copy on the phone */ }
  if (memory) return memory;
  const saved = await metaRead(KEY);
  memory = saved && typeof saved === 'object' ? { keepOriginals: !!saved.keepOriginals } : { keepOriginals: false };
  return memory;
}

export function usePhotoSettings() {
  const [s, setS] = useState(memory || { keepOriginals: false });
  useEffect(() => {
    let alive = true;
    loadPhotoSettings().then((v) => { if (alive) setS(v); });
    return () => { alive = false; };
  }, []);
  return s;
}
