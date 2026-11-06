'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
  return (
    <>
      <header className="shell-header">
        <span className="brand">MonarchJobs</span>
        {NAV.filter((n) => n.roles.includes(staff.role)).map((n) => (
          <Link key={n.href} href={n.href} className={pathname.startsWith(n.href) ? 'active' : ''}>
            {n.label}
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
