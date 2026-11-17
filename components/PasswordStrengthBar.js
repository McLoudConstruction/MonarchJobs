'use client';

import { passwordStrength } from '@/lib/passwordStrength';

// Four-segment strength meter with a word (Weak / Fair / Good / Strong) and one tip.
export default function PasswordStrengthBar({ password, context, id }) {
  const s = passwordStrength(password, context);
  return (
    <div className="pw-meter" id={id}>
      <div
        className="pw-bar"
        role="meter"
        aria-label="Password strength"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={s.score}
        aria-valuetext={s.label || 'Nothing typed yet'}
      >
        {[1, 2, 3, 4].map((i) => <span key={i} className={i <= s.score ? `on lvl${s.score}` : ''} />)}
      </div>
      <div className="pw-meter-text">
        {s.label
          ? <><strong className={`lvl${s.score}`} aria-live="polite">{s.label}</strong>{s.tip && <span>{s.tip}</span>}</>
          : <span>Use at least 8 characters. Longer is stronger.</span>}
      </div>
    </div>
  );
}
