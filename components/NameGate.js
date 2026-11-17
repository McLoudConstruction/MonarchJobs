'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/useAuth';
import { validateName } from '@/lib/newUser';
import CenterCard from '@/components/CenterCard';

// Shown once after sign-in when no name is saved yet, so everyone appears by name in the app.
export default function NameGate({ token, onSaved, signOut }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const checked = validateName(name);
    if (checked.error) { setError(checked.error); return; }
    setBusy(true);
    setError('');
    try {
      await apiFetch('/api/account/name', token, { method: 'PUT', body: JSON.stringify({ full_name: checked.value }) });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <CenterCard>
      <h2 className="auth-welcome">What is your name?</h2>
      <p className="hint auth-sub">Your name is how you appear to everyone in the app.</p>
      <form className="pw-form auth-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="full_name">Full name</label>
          <input id="full_name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </div>
        {error && <div className="msg err">{error}</div>}
        <button className="primary big" type="submit" disabled={busy} style={{ width: '100%', marginTop: 12 }}>{busy ? 'Saving...' : 'Continue'}</button>
        <button type="button" className="secondary" style={{ width: '100%', marginTop: 8 }} onClick={signOut}>Sign out</button>
      </form>
    </CenterCard>
  );
}
