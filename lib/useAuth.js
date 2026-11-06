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
      if (event === 'SIGNED_OUT' || !session) router.replace('/login');
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

// fetch wrapper that attaches the access token
export async function apiFetch(path, token, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
