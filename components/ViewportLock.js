'use client';

import { useEffect } from 'react';

// Keeps the page at a fixed zoom on phones. The viewport tag and 16px fields stop the zoom that
// happens when a field is focused; this also stops iOS Safari's pinch-to-zoom on the page itself
// (Safari ignores user-scalable=no). Pinch on the sketch and photo viewers is handled by those
// components with pointer events, so it is not affected.
export default function ViewportLock() {
  useEffect(() => {
    const stop = (e) => e.preventDefault();
    document.addEventListener('gesturestart', stop);
    document.addEventListener('gesturechange', stop);
    return () => {
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
    };
  }, []);
  return null;
}
