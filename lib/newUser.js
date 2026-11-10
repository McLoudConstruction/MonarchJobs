import { checkNewPassword } from './passwordRules.js';

export const STAFF_ROLES = ['owner', 'office', 'tech'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Checks the "Add user" form. Returns { error } or { value } with cleaned fields.
export function validateNewUser(input) {
  const email = String(input?.email || '').trim().toLowerCase();
  const full_name = String(input?.full_name || '').trim().replace(/\s+/g, ' ');
  const role = input?.role;
  const password = String(input?.password || '');

  if (!full_name) return { error: 'Enter the person\'s name.' };
  if (full_name.includes('@')) return { error: 'Enter their name, not an email address.' };
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address.' };
  if (!STAFF_ROLES.includes(role)) return { error: 'Choose a role.' };
  const pw = checkNewPassword(password, password);
  if (pw) return { error: pw };
  return { value: { email, full_name, role, password } };
}

// Checks a name someone types for themselves or the owner edits.
export function validateName(raw) {
  const full_name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!full_name) return { error: 'Enter your name.' };
  if (full_name.includes('@')) return { error: 'Enter a name, not an email address.' };
  if (full_name.length > 120) return { error: 'That name is too long.' };
  return { value: full_name };
}

// New users are created with a temporary password and this flag in their login's metadata.
// It is cleared when they choose their own password.
export function needsPasswordChange(user) {
  return user?.user_metadata?.must_change_password === true;
}
