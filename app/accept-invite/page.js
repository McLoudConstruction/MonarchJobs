'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabaseClient';
import { parseAuthLinkError } from '@/lib/authLink';
import NewPasswordForm from '@/components/NewPasswordForm';
import { hasRealName } from '@/lib/userDisplay';

// Landing page for the emailed invite link. Supabase reads the invite token from the address and
// signs the person in for this one purpose; they must then choose their own password.
export default function AcceptInvitePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [fullName, setFullName] = useState('');
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // An expired or already-used link comes back with the problem in the address: say so right away.
    if (parseAuthLinkError(window.location.hash) || parseAuthLinkError(window.location.search)) {
      setExpired(true);
      return undefined;
    }
    const supabase = getSupabase();
    let timer;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') && session) {
        clearTimeout(timer);
        setUser(session.user);
      }
    });
    // If the link was already processed before this page mounted, a session exists.
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) { clearTimeout(timer); setUser(data.session.user); }
    });
    // No session after a few seconds means the link is invalid, used, or expired.
    timer = setTimeout(() => setExpired(true), 4000);
    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  // The name the owner typed when inviting is saved on the staff record; use it for the greeting.
  // (The invite's own metadata is only a fallback.)
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const fromMeta = String(user.user_metadata?.full_name || '').trim();
    setFullName(hasRealName(fromMeta) ? fromMeta : '');
    getSupabase().from('staff_users').select('full_name').eq('id', user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled && hasRealName(data?.full_name)) setFullName(data.full_name.trim()); })
      .catch(() => { /* greeting just stays plain */ });
    return () => { cancelled = true; };
  }, [user]);

  async function save(password) {
    setBusy(true);
    setError('');
    try {
      const { error: err } = await getSupabase().auth.updateUser({
        password,
        data: { must_change_password: false },
      });
      if (err) { setError(err.message); setBusy(false); return; }
      setDone(true);
      setTimeout(() => router.replace('/dashboard'), 1500);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const first = fullName.split(/\s+/)[0];

  return (
    <div className="center-wrap">
      <div className="card">
        <span className="brand">Monarch <span>Jobs</span></span>
        {done ? (
          <div className="msg ok">Password saved. Taking you to the app...</div>
        ) : user ? (
          <>
            <h2 style={{ marginTop: 0 }}>{first ? `Welcome, ${first}` : 'Welcome'}</h2>
            <p className="hint">Choose a password for your MonarchJobs account ({user.email}). You will use it with your email to sign in.</p>
            <NewPasswordForm
              onSubmit={save}
              submitLabel="Save password and continue"
              busy={busy}
              error={error}
              email={user.email}
              name={fullName}
            />
          </>
        ) : expired ? (
          <>
            <div className="msg err">This invite link is invalid or has expired. Invite links can only be used once.</div>
            <p className="hint">Already chosen a password? <Link href="/login">Sign in</Link>. Otherwise ask the owner to send your invite again.</p>
          </>
        ) : (
          <p className="hint">Checking your invite...</p>
        )}
      </div>
    </div>
  );
}
