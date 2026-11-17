'use client';

import { useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import NewPasswordForm from '@/components/NewPasswordForm';

// Shown before anything else in the app when someone has not chosen their own password yet:
// they opened their invite link but left before saving one, or are still on an old temporary password.
export default function PasswordGate({ user, onSaved, signOut }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(password) {
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
      <div className="card">
        <h2>Choose your password</h2>
        <p className="hint">Before you continue, choose your own password. You will use it with your email to sign in.</p>
        <NewPasswordForm
          onSubmit={save}
          busy={busy}
          error={error}
          email={user?.email}
          name={user?.user_metadata?.full_name}
          footer={<button type="button" className="secondary" style={{ marginTop: 10, width: '100%' }} onClick={signOut}>Sign out</button>}
        />
      </div>
    </div>
  );
}
