'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This page is now part of Activity. Old links, bookmarks and push notifications still land in the right place.
export default function Redirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/activity'); }, [router]);
  return null;
}
