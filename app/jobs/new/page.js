'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// Jobs are no longer booked directly. Every job starts as a lead and becomes a job when its work
// order is created. Old links and bookmarks land on the right place.
function Redirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const lead = params.get('lead');
    const customer = params.get('customer');
    router.replace(lead ? `/leads/${lead}` : customer ? `/leads/new?customer=${customer}` : '/leads/new');
  }, [router, params]);
  return <p className="muted">Taking you to Leads...</p>;
}

export default function NewJobRedirect() {
  return <Suspense fallback={<p>Loading...</p>}><Redirect /></Suspense>;
}
