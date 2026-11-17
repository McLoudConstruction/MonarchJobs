'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabaseClient';
import NewPasswordForm from '@/components/NewPasswordForm';
import BrandLogo from '@/components/BrandLogo';

// Landing page for the emailed reset link. Supabase reads the recovery token from the URL
// and signs the person in for this one purpose; we then let them set a new password.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    let timer;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        clearTimeout(timer);
        setUser(session.user);
      }
    });
    // If the link was already processed before this page mounted, a session exists.
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) setUser(data.session.user);
    });
    // No session after a few seconds means the link is invalid, used, or expired.
    timer = setTimeout(() => setExpired(true), 4000);
    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  async function save(password) {
    setBusy(true);
    setError('');
    try {
      const { error: err } = await getSupabase().auth.updateUser({ password, data: { must_change_password: false } });
      if (err) {
        setError(err.message);
        setBusy(false);
        return;
      }
      setDone(true);
      setTimeout(() => router.replace('/dashboard'), 1500);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="center-wrap">
      <div className="card compact">
        <BrandLogo />
        {done ? (
          <div className="msg ok">Password updated. Taking you to the app...</div>
        ) : user ? (
          <>
            <div className="auth-head">
              <h2 className="auth-welcome">Choose a new password</h2>
              <span className="auth-email">{user.email}</span>
            </div>
            <NewPasswordForm
              onSubmit={save}
              submitLabel="Save new password"
              busy={busy}
              error={error}
              email={user.email}
              name={user.user_metadata?.full_name}
            />
          </>
        ) : expired ? (
          <>
            <h2 className="auth-welcome">Reset link expired</h2>
            <div className="msg err">This reset link is invalid or has expired. Links can only be used once.</div>
            <p className="auth-links"><Link href="/forgot-password">Request a new link</Link></p>
          </>
        ) : (
          <p className="hint" style={{ margin: 0 }}>Checking your link...</p>
        )}
      </div>
    </div>
  );
}
