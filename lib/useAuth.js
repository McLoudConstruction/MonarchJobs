'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { cacheClearAll, getQueue } from '@/lib/offlineClient';

// The signed-in person's profile, kept on this phone so the app can open with no signal.
const STAFF_KEY = 'mj-saved-staff';
const readSavedStaff = () => { try { return JSON.parse(localStorage.getItem(STAFF_KEY) || 'null'); } catch { return null; } };
const saveStaff = (s) => { try { localStorage.setItem(STAFF_KEY, JSON.stringify({ id: s.id, email: s.email, full_name: s.full_name, role: s.role, active: true })); } catch { /* storage blocked */ } };
const forgetSavedStaff = () => { try { localStorage.removeItem(STAFF_KEY); } catch { /* nothing to do */ } };
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const isRetryable = (e) => !!e && /retryable|failed to fetch|network|load failed/i.test(`${e.name || ''} ${e.message || ''}`);

// Loads the signed-in user and their staff row. Redirects to /login when not allowed in.
export function useAuth({ requireRole } = {}) {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, user: null, staff: null, token: null, error: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setState({ loading: false, user: null, staff: null, token: null, error: 'config' });
      return undefined;
    }
    let cancelled = false;
    const supabase = getSupabase();

    async function load() {
      let session = null;
      let sessionError = null;
      try {
        const r = await supabase.auth.getSession();
        session = r.data?.session || null;
        sessionError = r.error || null;
      } catch (e) { sessionError = e; }
      if (!session) {
        // No signal: the saved sign-in cannot be renewed right now. Let the person keep working from what is saved on this
        // phone (taking photos, writing notes). Only a real sign-out sends them to the login page.
        const saved = readSavedStaff();
        if (saved && (isOffline() || isRetryable(sessionError))) {
          if (!cancelled) setState({ loading: false, user: { id: saved.id, email: saved.email }, staff: saved, token: null, error: requireRole && !requireRole.includes(saved.role) ? 'forbidden' : null, offline: true });
          return;
        }
        router.replace('/login');
        return;
      }
      let staff = null;
      const got = await supabase
        .from('staff_users')
        .select('id,email,full_name,role,active')
        .eq('id', session.user.id)
        .maybeSingle();
      staff = got.data;
      if (!staff && got.error) {
        // the profile could not be read (no signal): use the copy saved at the last sign-in
        const saved = readSavedStaff();
        if (saved && saved.id === session.user.id) staff = saved;
      }
      if (staff && staff.active) saveStaff(staff);
      if (cancelled) return;
      if (!staff || !staff.active) {
        setState({ loading: false, user: session.user, staff: null, token: session.access_token, error: 'pending' });
        return;
      }
      if (requireRole && !requireRole.includes(staff.role)) {
        setState({ loading: false, user: session.user, staff, token: session.access_token, error: 'forbidden' });
        return;
      }
      setState({ loading: false, user: session.user, staff, token: session.access_token, error: null });
    }
    load();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        forgetSavedStaff();
        cacheClearAll(); // the copies of job data go; pictures waiting to upload stay
        router.replace('/login');
        return;
      }
      if (!session) {
        // a failed renewal with no signal looks like this too: only leave when really online
        if (!isOffline()) router.replace('/login');
        return;
      }
      // Supabase swaps the access token about once an hour. Keep ours current so pages that
      // were left open do not keep sending an expired one.
      if (event === 'TOKEN_REFRESHED') {
        setState((s) => (s.token === session.access_token ? s : { ...s, token: session.access_token }));
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router, requireRole, reloadKey]);

  const signOut = useCallback(async () => {
    try {
      const q = await getQueue();
      const st = q ? await q.stats() : null;
      const n = st ? st.pending + st.blocked : 0;
      if (n > 0 && typeof window !== 'undefined' && !window.confirm(`${n} picture${n === 1 ? ' is' : 's are'} still waiting to upload. They stay safe on this phone, but will not upload until you sign in again. Sign out anyway?`)) return;
    } catch { /* could not check: sign out */ }
    forgetSavedStaff();
    cacheClearAll();
    await getSupabase().auth.signOut();
    router.replace('/login');
  }, [router]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { ...state, signOut, reload };
}

// Returns the current access token, refreshing it first if it has expired. Falls back to the
// token the caller already holds if the session cannot be read.
export async function currentToken(fallback) {
  try {
    const { data } = await getSupabase().auth.getSession();
    return data?.session?.access_token || fallback;
  } catch {
    return fallback;
  }
}

// Asks Supabase for a brand new access token using the refresh token. Returns null when the
// login session no longer exists on the server (signed out elsewhere, password reset, expired).
async function renewToken() {
  try {
    const { data, error } = await getSupabase().auth.refreshSession();
    return error ? null : data?.session?.access_token || null;
  } catch {
    return null;
  }
}

function send(path, token, options) {
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  return fetch(path, {
    ...options,
    headers: {
      // For file uploads the browser must set the multipart boundary itself.
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

// fetch wrapper that attaches the access token. The token argument is only a fallback: the current
// one is read from the session on every call. If the server still answers 401 ("Not signed in"),
// it gets one retry with a freshly issued token. If the login session is gone for good, the user
// is sent to the sign-in page instead of being left on a page that looks signed in but is not.
export async function apiFetch(path, token, options = {}) {
  let res = await send(path, await currentToken(token), options);
  if (res.status === 401) {
    const renewed = await renewToken();
    if (!renewed) {
      try { await getSupabase().auth.signOut({ scope: 'local' }); } catch { /* already gone */ }
      if (typeof window !== 'undefined') window.location.assign('/login');
      throw new Error('Your login session ended. Please sign in again.');
    }
    res = await send(path, renewed, options);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
