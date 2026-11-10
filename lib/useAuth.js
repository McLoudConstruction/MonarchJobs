'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabaseClient';

// Loads the signed-in user and their staff row. Redirects to /login when not allowed in.
export function useAuth({ requireRole } = {}) {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, user: null, staff: null, token: null, error: null });

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setState({ loading: false, user: null, staff: null, token: null, error: 'config' });
      return undefined;
    }
    let cancelled = false;
    const supabase = getSupabase();

    async function load() {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      if (!session) {
        router.replace('/login');
        return;
      }
      const { data: staff } = await supabase
        .from('staff_users')
        .select('id,email,full_name,role,active')
        .eq('id', session.user.id)
        .maybeSingle();
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
      if (event === 'SIGNED_OUT' || !session) {
        router.replace('/login');
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
  }, [router, requireRole]);

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    router.replace('/login');
  }, [router]);

  return { ...state, signOut };
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
