'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';

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
      <form className="card" onSubmit={onSubmit}>
        <span className="brand">Monarch <span>Jobs</span></span>
        {sent ? (
          <>
            <div className="msg ok">If that email belongs to a staff account, a reset link is on its way. It can take a few minutes; check spam too.</div>
            <p className="hint"><Link href="/login">Back to sign in</Link></p>
          </>
        ) : (
          <>
            <p className="hint">Enter your staff email and we will send you a link to choose a new password.</p>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            {error && <div className="msg err">{error}</div>}
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</button>
            <p className="hint" style={{ marginTop: 14, marginBottom: 0 }}><Link href="/login">Back to sign in</Link></p>
          </>
        )}
      </form>
    </div>
  );
}
