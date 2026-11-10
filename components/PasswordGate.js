'use client';

import { useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { checkNewPassword, MIN_PASSWORD_LENGTH } from '@/lib/passwordRules';

// Shown after the first sign-in with a temporary password, before anything else in the app.
export default function PasswordGate({ onSaved, signOut }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const problem = checkNewPassword(password, confirm);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    try {
      const { error: err } = await getSupabase().auth.updateUser({
        password,
        data: { must_change_password: false },
      });
      if (err) { setError(err.message); setBusy(false); return; }
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="center-wrap">
      <form className="card" onSubmit={submit}>
        <h2>Choose your password</h2>
        <p className="hint">You signed in with a temporary password. Choose your own to continue (at least {MIN_PASSWORD_LENGTH} characters).</p>
        <div className="field">
          <label htmlFor="new-pw">New password</label>
          <input id="new-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
        </div>
        <div className="field">
          <label htmlFor="confirm-pw">Confirm new password</label>
          <input id="confirm-pw" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {error && <div className="msg err">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save password'}</button>
        <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={signOut}>Sign out</button>
      </form>
    </div>
  );
}
