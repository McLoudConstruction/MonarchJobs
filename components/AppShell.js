'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', roles: ['owner', 'office', 'tech'] },
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
