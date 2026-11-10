'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabaseClient';
import { checkNewPassword } from '@/lib/passwordRules';

// Landing page for the emailed reset link. Supabase reads the recovery token from the URL
// and signs the person in for this one purpose; we then let them set a new password.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    let timer;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        clearTimeout(timer);
        setReady(true);
      }
    });
    // If the link was already processed before this page mounted, a session exists.
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) setReady(true);
    });
    // No session after a few seconds means the link is invalid, used, or expired.
    timer = setTimeout(() => setExpired(true), 4000);
    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    const problem = checkNewPassword(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { error: err } = await getSupabase().auth.updateUser({ password });
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
      <form className="card" onSubmit={onSubmit}>
        <span className="brand">Monarch <span>Jobs</span></span>
        {done ? (
          <div className="msg ok">Password updated. Taking you to the app...</div>
        ) : ready ? (
          <>
            <p className="hint">Choose a new password for your staff account.</p>
            <div className="field">
              <label htmlFor="password">New password</label>
              <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>
            <div className="field">
              <label htmlFor="confirm">Confirm new password</label>
              <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
            </div>
            {error && <div className="msg err">{error}</div>}
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save new password'}</button>
          </>
        ) : expired ? (
          <>
            <div className="msg err">This reset link is invalid or has expired. Links can only be used once.</div>
            <p className="hint"><Link href="/forgot-password">Request a new link</Link></p>
          </>
        ) : (
          <p className="hint">Checking your link...</p>
        )}
      </form>
    </div>
  );
}
