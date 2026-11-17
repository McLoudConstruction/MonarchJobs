'use client';

import { useState } from 'react';
import './password.css';
import PasswordField from '@/components/PasswordField';
import PasswordStrengthBar from '@/components/PasswordStrengthBar';
import { checkNewPassword, passwordRequirements } from '@/lib/passwordRules';

// The one form for choosing a password: new password (with strength bar), confirm password, and an
// eye on each box. The button stays off until the password is strong enough and both boxes match.
// Props: onSubmit(password), submitLabel, busyLabel, busy, error,
//        email / name: the person's details (kept out of the password, and handed to password managers),
//        footer: extra buttons shown under Save.
export default function NewPasswordForm({ onSubmit, submitLabel = 'Save password', busyLabel = 'Saving...', busy = false, error = '', email = '', name = '', footer = null }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const context = [email, name];
  const problem = checkNewPassword(password, confirm, context);
  const mismatch = confirm !== '' && password !== confirm;
  const matches = confirm !== '' && password === confirm;

  function submit(e) {
    e.preventDefault();
    if (problem || busy) return;
    onSubmit(password);
  }

  return (
    <form onSubmit={submit} noValidate>
      {/* lets a password manager save the new password against the right account */}
      {email && <input className="pw-username" type="email" name="username" autoComplete="username" value={email} readOnly tabIndex={-1} aria-hidden="true" />}
      <PasswordField id="new-password" label="New password" value={password} onChange={setPassword} autoFocus describedBy="new-password-meter" />
      <PasswordStrengthBar id="new-password-meter" password={password} context={context} />
      <ul className="pw-reqs" aria-label="Password requirements">
        {passwordRequirements(password).map((r) => (
          <li key={r.id} className={r.met ? 'met' : ''}>
            <span aria-hidden="true">{r.met ? '✓' : '○'}</span> {r.label}<span className="sr-only"> {r.met ? '(done)' : '(not yet)'}</span>
          </li>
        ))}
      </ul>
      <PasswordField id="confirm-password" label="Confirm password" value={confirm} onChange={setConfirm} describedBy="confirm-password-note" invalid={mismatch} />
      <div id="confirm-password-note" className={`pw-match ${mismatch ? 'bad' : matches ? 'ok' : ''}`} aria-live="polite">
        {mismatch ? 'The two passwords do not match.' : matches ? 'Passwords match.' : ''}
      </div>
      {error && <div className="msg err">{error}</div>}
      <button className="primary big" type="submit" disabled={busy || !!problem} style={{ width: '100%', marginTop: 8 }}>{busy ? busyLabel : submitLabel}</button>
      {footer}
    </form>
  );
}
