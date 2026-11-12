'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getSupabase } from '@/lib/supabaseClient';
import { useTheme } from '@/lib/useTheme';
import { initialsFor, displayNameFor } from '@/lib/userDisplay';
import { DashboardIcon, SalesIcon, ScheduleIcon, JobDashboardIcon, SettingsIcon, SunIcon, MoonIcon, UserIcon, SignOutIcon, MoreIcon, BellIcon } from '@/components/icons';
import BottomSheet from '@/components/BottomSheet';
import JobJumpSearch from '@/components/JobJumpSearch';
import { logoUrl } from '@/lib/branding';
import { NotificationsProvider, useNotificationCenter } from '@/lib/useNotifications';
import { readPushStatus, resyncPush } from '@/lib/push';

const ALL = ['owner', 'office', 'tech'];
const OFFICE = ['owner', 'office'];
const ROLE_LABELS = { owner: 'Owner', office: 'Office', tech: 'Technician' };

// Main navigation, same layout as McLoud Jobs: a row of links in the dark top bar.
// primary = also shown on the phone's bottom bar (the rest go under More).
const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: DashboardIcon, roles: ALL, primary: true },
  { href: '/leads', label: 'Leads', icon: SalesIcon, roles: OFFICE, primary: true },
  { href: '/schedule', label: 'Schedule', icon: ScheduleIcon, roles: ALL, primary: true },
  { href: '/jobs', label: 'Jobs', icon: JobDashboardIcon, roles: ALL, primary: true },
  { href: '/customers', label: 'Customers', icon: UserIcon, roles: OFFICE },
  // sideOnly: phones reach it from the bell in the top bar
  { href: '/notifications', label: 'Notifications', icon: BellIcon, roles: ALL, sideOnly: true },
];

const NUDGE_KEY = 'mj_push_nudge';
const NUDGE_DAYS = 14;

// The business logo replaces the "Monarch Jobs" text once one is uploaded in Settings. The path is
// remembered for the browser session so the logo is there immediately on every page.
const LOGO_CACHE = 'mj_logo_path';

function useBrandLogo() {
  const [brand, setBrand] = useState({ loaded: false, path: null });
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(LOGO_CACHE);
      if (cached !== null) setBrand({ loaded: true, path: cached || null });
    } catch { /* storage unavailable */ }
    let alive = true;
    const load = () => getSupabase().from('settings').select('logo_path').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const path = data?.logo_path || null;
        setBrand({ loaded: true, path });
        try { sessionStorage.setItem(LOGO_CACHE, path || ''); } catch { /* ignore */ }
      });
    load();
    window.addEventListener('branding-changed', load);
    return () => { alive = false; window.removeEventListener('branding-changed', load); };
  }, []);
  return brand;
}

function Brand({ brand }) {
  const url = logoUrl(brand.path);
  if (url) return <img className="brand-logo" src={url} alt="Monarch Cleaning & Restoration" />;
  // hidden until we know, so the text does not flash before the logo appears
  return <span className="brand" style={brand.loaded ? undefined : { visibility: 'hidden' }}>Monarch <span>Jobs</span></span>;
}

const isActive = (item, pathname) => pathname === item.href || pathname.startsWith(`${item.href}/`);

// Wraps the shell so the sidebar badge, the phone top bar and the Notifications page share one live feed.
export default function AppShell(props) {
  return (
    <NotificationsProvider userId={props.staff.id}>
      <AppShellInner {...props} />
    </NotificationsProvider>
  );
}

function AppShellInner({ staff, signOut, children }) {
  const pathname = usePathname() || '';
  const { unread } = useNotificationCenter();
  const [nudge, setNudge] = useState(null);
  const { theme, setTheme } = useTheme();
  const [ready, setReady] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);
  const brand = useBrandLogo();

  const nav = NAV.filter((n) => n.roles.includes(staff.role));
  const canSettings = staff.role === 'owner';
  const initials = initialsFor(staff.full_name, staff.email);
  const name = displayNameFor(staff.full_name, staff.email);
  const roleLabel = ROLE_LABELS[staff.role] || staff.role;

  // customers who approved their estimate and are waiting to be scheduled
  useEffect(() => {
    if (!OFFICE.includes(staff.role)) return;
    getSupabase().from('leads').select('id', { count: 'exact', head: true }).eq('status', 'accepted')
      .then(({ count }) => setReady(count || 0));
  }, [staff.role, pathname]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900);
    check();
    setMounted(true);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (!accountOpen) return undefined;
    const onDown = (e) => { if (accountRef.current && !accountRef.current.contains(e.target)) setAccountOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setAccountOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [accountOpen]);

  // One gentle reminder, not a nag: shown until push is on or the person dismisses it for two weeks.
  useEffect(() => {
    let alive = true;
    resyncPush('');
    (async () => {
      try {
        const last = Number(localStorage.getItem(NUDGE_KEY) || 0);
        if (Date.now() - last < NUDGE_DAYS * 86400000) return;
      } catch { /* storage unavailable: show it */ }
      const status = await readPushStatus();
      if (alive && (status === 'off' || status === 'needs_install')) setNudge(status);
    })();
    return () => { alive = false; };
  }, []);

  function dismissNudge() {
    setNudge(null);
    try { localStorage.setItem(NUDGE_KEY, String(Date.now())); } catch { /* ignore */ }
  }

  const moreItems = [
    ...nav.filter((n) => !n.primary && !n.sideOnly),
    ...(canSettings ? [{ href: '/settings', label: 'Settings', icon: SettingsIcon }] : []),
  ];
  const moreActive = moreItems.some((n) => isActive(n, pathname));

  return (
    <div className="shell">
      <aside className="side" aria-label="Main">
        <div className="side-brand"><Brand brand={brand} /></div>
        <div className="side-search"><JobJumpSearch role={staff.role} /></div>
        <nav className="side-nav">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={`side-link ${isActive(n, pathname) ? 'active' : ''}`} aria-current={isActive(n, pathname) ? 'page' : undefined}>
              <n.icon className="side-icon" />
              <span>{n.label}</span>
              {n.href === '/leads' && ready > 0 && <span className="nav-count" title="Approved estimates waiting to be scheduled">{ready}</span>}
              {n.href === '/notifications' && unread > 0 && <span className="nav-count" title="Unread notifications">{unread > 99 ? '99+' : unread}</span>}
            </Link>
          ))}
        </nav>
        <div className="side-spacer" />
        <div ref={accountRef} className="shell-account side-account">
          <button type="button" className="side-account-toggle" aria-haspopup="menu" aria-expanded={accountOpen} aria-label={`Account menu for ${name}`} onClick={() => setAccountOpen((o) => !o)}>
            <span className="shell-account-btn side-avatar">{initials}</span>
            <span className="side-who">{name}<small>{roleLabel}</small></span>
          </button>
          {accountOpen && (
            <div className="shell-account-menu" role="menu">
              <div className="shell-account-head">
                <div className="shell-account-name">{name || 'Signed in'}</div>
                <div className="shell-account-sub">{roleLabel}</div>
              </div>
              <div className="shell-account-divider" />
              <button type="button" role="menuitem" className="shell-account-item" onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setAccountOpen(false); }}>
                {theme === 'dark' ? <MoonIcon className="shell-account-icon" /> : <SunIcon className="shell-account-icon" />}
                {theme === 'dark' ? 'Dark mode' : 'Light mode'}
              </button>
              {canSettings && (
                <Link href="/settings" role="menuitem" className="shell-account-item" onClick={() => setAccountOpen(false)}>
                  <SettingsIcon className="shell-account-icon" />
                  Settings
                </Link>
              )}
              <div className="shell-account-divider" />
              <button type="button" role="menuitem" className="shell-account-item" onClick={signOut}>
                <SignOutIcon className="shell-account-icon" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* phones keep a slim top bar with the logo and the bottom nav */}
      <div className="shell-topbar shell-topbar-mobile">
        <div className="shell-logo"><Brand brand={brand} /></div>
        <div className="shell-topbar-actions">
          <Link href="/notifications" className="shell-topbar-icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
            <BellIcon />
            {unread > 0 && <span className="shell-topbar-count">{unread > 99 ? '99+' : unread}</span>}
          </Link>
        </div>
      </div>

      <div className="shell-body">
        {isMobile && (
          <nav className="shell-bottomnav">
            {nav.filter((n) => n.primary).map((n) => (
              <Link key={n.href} href={n.href} className={`shell-bottomnav-link ${isActive(n, pathname) ? 'active' : ''}`} aria-label={n.label}>
                <span style={{ position: 'relative', display: 'inline-flex' }}>
                  <n.icon className="shell-bottomnav-icon" />
                  {n.href === '/leads' && ready > 0 && <span className="shell-bottomnav-dot" />}
                </span>
                <span className="shell-bottomnav-label">{n.label}</span>
              </Link>
            ))}
            <button type="button" className={`shell-bottomnav-link ${moreActive ? 'active' : ''}`} aria-label="More" onClick={() => setMoreOpen(true)}>
              <span style={{ position: 'relative', display: 'inline-flex' }}><MoreIcon className="shell-bottomnav-icon" /></span>
              <span className="shell-bottomnav-label">More</span>
            </button>
          </nav>
        )}

        <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
          <div className="more-sheet-who">
            <UserIcon className="more-sheet-icon" />
            <span>{name}<small>{roleLabel}</small></span>
          </div>
          {moreItems.map((n) => (
            <Link key={n.href} href={n.href} className={`more-sheet-link ${isActive(n, pathname) ? 'active' : ''}`} onClick={() => setMoreOpen(false)}>
              <n.icon className="more-sheet-icon" />
              {n.label}
            </Link>
          ))}
          <div className="more-sheet-divider" />
          <button type="button" className="more-sheet-link" onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setMoreOpen(false); }}>
            {theme === 'dark' ? <MoonIcon className="more-sheet-icon" /> : <SunIcon className="more-sheet-icon" />}
            {theme === 'dark' ? 'Dark mode' : 'Light mode'}
          </button>
          <button type="button" className="more-sheet-link" onClick={signOut}>
            <SignOutIcon className="more-sheet-icon" />
            Sign out
          </button>
        </BottomSheet>

        <div className="shell-content">
          <div className="page">
            {nudge && pathname !== '/notifications' && (
              <div className="push-nudge" role="status">
                <span>{nudge === 'needs_install' ? 'Add MonarchJobs to your Home Screen to get notifications.' : 'Get notified when something needs you, even when the app is closed.'}</span>
                <Link href="/notifications" onClick={dismissNudge}>Set up</Link>
                <button type="button" aria-label="Dismiss" onClick={dismissNudge}>&times;</button>
              </div>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
