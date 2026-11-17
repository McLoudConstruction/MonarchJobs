'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { logoUrl } from '@/lib/branding';
import './password.css';

// The business logo uploaded in Settings (same one the app header shows), or the "Monarch Jobs" text
// when none is set. The logo path is only readable once someone is signed in, so pass enabled={false}
// until then; the space stays reserved so the page does not jump.
const LOGO_CACHE = 'mj_logo_path'; // shared with the app header

export default function BrandLogo({ enabled = true }) {
  const [brand, setBrand] = useState({ loaded: false, path: null });

  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(LOGO_CACHE);
      if (cached !== null) setBrand({ loaded: true, path: cached || null });
    } catch { /* storage unavailable */ }
    if (!enabled) return undefined;
    let alive = true;
    getSupabase().from('settings').select('logo_path').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const path = data?.logo_path || null;
        setBrand({ loaded: true, path });
        try { sessionStorage.setItem(LOGO_CACHE, path || ''); } catch { /* ignore */ }
      })
      .catch(() => { if (alive) setBrand((b) => ({ ...b, loaded: true })); });
    return () => { alive = false; };
  }, [enabled]);

  const url = logoUrl(brand.path);
  if (url) return <img className="auth-logo" src={url} alt="Monarch Cleaning & Restoration" />;
  // hidden until we know, so the text does not flash before the logo appears
  return <span className="brand" style={brand.loaded ? undefined : { visibility: 'hidden' }}>Monarch <span>Jobs</span></span>;
}
