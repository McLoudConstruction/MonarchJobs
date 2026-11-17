'use client';

import { useState } from 'react';
import { EyeIcon, EyeOffIcon } from '@/components/icons';

// A password input with an eye button that shows or hides what is typed.
export default function PasswordField({ id, label, value, onChange, autoFocus = false, describedBy, invalid = false, autoComplete = 'new-password' }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          required
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        />
        <button
          type="button"
          className="pw-eye"
          onClick={() => setShown((s) => !s)}
          onMouseDown={(e) => e.preventDefault() /* keep the cursor in the box */}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
        >
          {shown ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}
