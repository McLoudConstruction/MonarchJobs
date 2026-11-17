'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabaseClient';
import BrandLogo from '@/components/BrandLogo';
import PasswordField from '@/components/PasswordField';

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
      <div className="card compact">
        <BrandLogo />
        <h2 className="auth-welcome">Sign in</h2>
        <form className="pw-form auth-form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" autoCapitalize="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
          {error && <div className="msg err">{error}</div>}
          <button className="primary big" type="submit" disabled={busy} style={{ width: '100%', marginTop: 12 }}>{busy ? 'Signing in...' : 'Sign in'}</button>
        </form>
        <p className="auth-links"><Link href="/forgot-password">Forgot password?</Link></p>
      </div>
    </div>
  );
}
