'use client';

import { useEffect, useState } from 'react';
import { addressLine } from '@/lib/format';

// iPhone, iPad and Mac get Apple Maps; everything else gets Google Maps.
// iPadOS Safari reports itself as a Mac, so a Mac with a touch screen is an iPad.
function isAppleDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

export function mapsHref(text, apple) {
  const q = encodeURIComponent(text);
  return apple ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// Renders an address as a link that opens the phone or tablet's maps app.
export default function MapLink({ address, className, children }) {
  const [apple, setApple] = useState(false);
  useEffect(() => { setApple(isAppleDevice()); }, []);

  const text = typeof address === 'string' ? address : addressLine(address);
  if (!text) return null;

  return (
    <a
      className={className}
      href={mapsHref(text, apple)}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: 'var(--accent-text)', textDecoration: 'underline' }}
    >
      {children || text}
    </a>
  );
}
