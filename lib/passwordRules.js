// Shared password rules for every screen where someone chooses a password (accept invite, reset,
// first sign-in). Returns an error string, or '' when the pair is fine.
import { passwordStrength } from './passwordStrength.js';

export const MIN_PASSWORD_LENGTH = 8;
// Lowest strength allowed: 2 = Fair (Raise to 3 to require "Good"). With the requirements below
// this mainly stops common passwords, simple sequences and passwords built from the person's name.
export const MIN_STRENGTH = 2;

// The checklist shown under the password box. Every one must be met.
export const PASSWORD_REQUIREMENTS = [
  { id: 'length', label: `At least ${MIN_PASSWORD_LENGTH} characters`, message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`, test: (p) => p.length >= MIN_PASSWORD_LENGTH },
  { id: 'upper', label: '1 capital letter', message: 'Add at least one capital letter.', test: (p) => /[A-Z]/.test(p) },
  { id: 'lower', label: '1 lowercase letter', message: 'Add at least one lowercase letter.', test: (p) => /[a-z]/.test(p) },
  { id: 'number', label: '1 number', message: 'Add at least one number.', test: (p) => /[0-9]/.test(p) },
  { id: 'symbol', label: '1 symbol (like ! # $ -)', message: 'Add at least one symbol, like ! # $ or -.', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

// [{ id, label, met }] for the live checklist.
export function passwordRequirements(password) {
  const p = String(password || '');
  return PASSWORD_REQUIREMENTS.map(({ id, label, test }) => ({ id, label, met: test(p) }));
}

// context: the person's email and name, so the password cannot be built from them.
export function checkNewPassword(password, confirm, context = []) {
  const p = String(password || '');
  const unmet = PASSWORD_REQUIREMENTS.find((r) => !r.test(p));
  if (unmet) return unmet.message;
  if (passwordStrength(p, context).score < MIN_STRENGTH) {
    return 'That password is too easy to guess. Avoid common words, simple sequences and your own name or email.';
  }
  if (p !== confirm) return 'The two passwords do not match.';
  return '';
}
