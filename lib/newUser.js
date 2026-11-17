export const STAFF_ROLES = ['owner', 'office', 'tech'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Checks the "Invite user" form. Returns { error } or { value } with cleaned fields.
// No password here: the person chooses their own from the emailed link.
export function validateNewUser(input) {
  const email = String(input?.email || '').trim().toLowerCase();
  const full_name = String(input?.full_name || '').trim().replace(/\s+/g, ' ');
  const role = input?.role;

  if (!full_name) return { error: 'Enter the person\'s name.' };
  if (full_name.includes('@')) return { error: 'Enter their name, not an email address.' };
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address.' };
  if (!STAFF_ROLES.includes(role)) return { error: 'Choose a role.' };
  return { value: { email, full_name, role } };
}

// Checks a name someone types for themselves or the owner edits.
export function validateName(raw) {
  const full_name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!full_name) return { error: 'Enter your name.' };
  if (full_name.includes('@')) return { error: 'Enter a name, not an email address.' };
  if (full_name.length > 120) return { error: 'That name is too long.' };
  return { value: full_name };
}

// Invited users carry this flag in their login's metadata until they choose their own password
// (older accounts were created with a temporary password and carry it too). It is cleared when
// they save a password, and while it is set the app shows the "Choose your password" screen.
export function needsPasswordChange(user) {
  return user?.user_metadata?.must_change_password === true;
}

// Turns an error from Supabase's invite / reset email calls into something the owner can act on.
// Returns { message, status }.
export function inviteErrorMessage(error) {
  const msg = String(error?.message || '');
  const code = String(error?.code || '');
  if (code === 'email_exists' || /already|registered|exists/i.test(msg)) {
    return { message: 'That email already has an account.', status: 409 };
  }
  if (error?.status === 429 || /rate limit|too many|seconds/i.test(`${code} ${msg}`)) {
    return {
      message: 'Supabase has hit its email limit for now. Wait a bit and try again. (The built-in sender allows very few emails per hour; custom SMTP in Supabase removes that limit.)',
      status: 429,
    };
  }
  return { message: msg || 'Could not send the invite.', status: 400 };
}
