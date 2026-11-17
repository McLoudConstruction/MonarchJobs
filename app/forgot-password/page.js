'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';
import BrandLogo from '@/components/BrandLogo';

// Staff request a reset link here. The same confirmation shows whether or not the email
// belongs to an account, so the page cannot be used to find out who has one.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { error: err } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Rate limits are worth showing; anything else gets the generic confirmation.
      if (err && /rate limit|too many|seconds/i.test(err.message)) {
        setError('Too many requests. Wait a minute and try again.');
      } else {
        setSent(true);
      }
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <div className="center-wrap">
      <div className="card compact">
        <BrandLogo />
        <h2 className="auth-welcome">Reset your password</h2>
        {sent ? (
          <>
            <div className="msg ok">If that email belongs to a staff account, a reset link is on its way. It can take a few minutes; check spam too.</div>
            <p className="auth-links"><Link href="/login">Back to sign in</Link></p>
          </>
        ) : (
          <>
            <p className="hint auth-sub">Enter your staff email and we will send you a link to choose a new password.</p>
            <form className="pw-form auth-form" onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" autoComplete="email" autoCapitalize="off" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </div>
              {error && <div className="msg err">{error}</div>}
              <button className="primary big" type="submit" disabled={busy} style={{ width: '100%', marginTop: 12 }}>{busy ? 'Sending...' : 'Send reset link'}</button>
            </form>
            <p className="auth-links"><Link href="/login">Back to sign in</Link></p>
          </>
        )}
      </div>
    </div>
  );
}
