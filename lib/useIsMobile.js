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

// True on iPads and other touch tablets: a touch screen at least 700px wide and 600px tall (phones in
// landscape are shorter than 600px). Same test as app/tablet.css, so the layout and the code agree.
const TABLET_QUERY = '(pointer: coarse) and (min-width: 700px) and (min-height: 600px)';

export function useIsTablet() {
  const [tablet, setTablet] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(TABLET_QUERY).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(TABLET_QUERY);
    const on = () => setTablet(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return tablet;
}
