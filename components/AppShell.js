'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getSupabase } from '@/lib/supabaseClient';

const ALL = ['owner', 'office', 'tech'];
const OFFICE = ['owner', 'office'];

const NAV = [
  { href: '/dashboard', label: 'Dashboard', roles: ALL },
  { href: '/leads', label: 'Leads', roles: OFFICE },
  { href: '/schedule', label: 'Schedule', roles: ALL },
  { href: '/jobs', label: 'Jobs', roles: ALL },
  { href: '/customers', label: 'Customers', roles: OFFICE },
  { href: '/settings', label: 'Settings', roles: ['owner'] },
];

export default function AppShell({ staff, signOut, children }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(0);

  // customers who approved their estimate and are waiting to be scheduled
  useEffect(() => {
    if (!OFFICE.includes(staff.role)) return;
    getSupabase().from('leads').select('id', { count: 'exact', head: true }).eq('status', 'accepted')
      .then(({ count }) => setReady(count || 0));
  }, [staff.role, pathname]);
  return (
    <>
      <header className="shell-header">
        <span className="brand">MonarchJobs</span>
        {NAV.filter((n) => n.roles.includes(staff.role)).map((n) => (
          <Link key={n.href} href={n.href} className={pathname.startsWith(n.href) ? 'active' : ''}>
            {n.label}
            {n.href === '/leads' && ready > 0 && <span className="nav-count" title="Approved estimates waiting to be scheduled">{ready}</span>}
          </Link>
        ))}
        <span className="spacer" />
        <span>{staff.full_name || staff.email} ({staff.role})</span>
        <button onClick={signOut}>Sign out</button>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
