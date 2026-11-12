'use client';

import { useEffect, useState } from 'react';

// True on phone-sized screens. Uses the same 900px breakpoint as the app shell (bottom nav appears
// below it). Only call it from components that render after sign-in, which is always on the client.
const QUERY = '(max-width: 899px)';

export function useIsMobile() {
  const [mobile, setMobile] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(QUERY).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}
