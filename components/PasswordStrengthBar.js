'use client';

import { passwordStrength } from '@/lib/passwordStrength';

// Four-segment strength meter with the word (Weak / Fair / Good / Strong) beside it. A line of advice
// appears only when the password is a common word, a simple pattern, or contains the person's name.
export default function PasswordStrengthBar({ password, context, id }) {
  const s = passwordStrength(password, context);
  return (
    <div className="pw-meter" id={id}>
      <div className="pw-meter-row">
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
        <strong className={`pw-label lvl${s.score}`} aria-live="polite">{s.label}</strong>
      </div>
      {s.flagged && s.tip && <div className="pw-meter-text">{s.tip}</div>}
    </div>
  );
}
