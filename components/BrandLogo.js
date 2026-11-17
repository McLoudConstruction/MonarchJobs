'use client';

import { useEffect, useState } from 'react';
import { logoUrl } from '@/lib/branding';
import './password.css';

// The business logo uploaded in Settings (the same one the app header shows), or the "Monarch Jobs"
// text when none is set. Used on the sign-in, invite and reset pages, so it reads the logo name from a
// public endpoint (no sign-in needed). The last name is remembered on this device so repeat visits
// show the logo immediately; until we know, the space stays reserved so the page does not jump.
const LOGO_CACHE = 'mj_logo_path'; // same key the app header uses

function readCached() {
  try {
    const v = sessionStorage.getItem(LOGO_CACHE) ?? localStorage.getItem(LOGO_CACHE);
    return v === null ? null : { loaded: true, path: v || null };
  } catch { return null; }
}

export default function BrandLogo() {
  const [brand, setBrand] = useState({ loaded: false, path: null });

  useEffect(() => {
    const cached = readCached();
    if (cached) setBrand(cached);
    let alive = true;
    fetch('/api/branding/public', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const path = d?.logo_path || null;
        setBrand({ loaded: true, path });
        try { sessionStorage.setItem(LOGO_CACHE, path || ''); localStorage.setItem(LOGO_CACHE, path || ''); } catch { /* ignore */ }
      })
      .catch(() => { if (alive) setBrand((b) => ({ ...b, loaded: true })); });
    return () => { alive = false; };
  }, []);

  const url = logoUrl(brand.path);
  if (url) return <img className="auth-logo" src={url} alt="Monarch Cleaning & Restoration" />;
  return <span className="brand" style={brand.loaded ? undefined : { visibility: 'hidden' }}>Monarch <span>Jobs</span></span>;
}
