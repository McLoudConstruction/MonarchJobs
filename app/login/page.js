'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabaseClient';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    let result;
    try {
      result = await getSupabase().auth.signInWithPassword({ email, password });
    } catch (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    router.replace('/dashboard');
  }

  return (
    <div className="center-wrap">
      <form className="card" onSubmit={onSubmit}>
        <span className="brand">Monarch <span>Jobs</span></span>
        <p className="hint">Sign in with your staff account.</p>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <div className="msg err">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </div>
  );
}
