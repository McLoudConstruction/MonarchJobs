'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { tabHref, legacyOwnerTab } from '@/lib/dashboardTabs';

// Activity, Invoices and Owner now live as tabs on the Dashboard. The old addresses still work (saved
// bookmarks, push notifications already sent) and land on the right tab, keeping any #section.
export default function TabRedirect({ tab, hash = '' }) {
  const router = useRouter();
  useEffect(() => { { const h = window.location.hash || hash; const t = legacyOwnerTab(tab, h); router.replace(tabHref(t, t === tab ? h : '')); } }, [router, tab, hash]);
  return <div className="center-wrap"><p>Loading...</p></div>;
}
