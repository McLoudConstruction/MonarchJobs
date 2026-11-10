// Shared password rules for the reset page. Returns an error string, or '' when the pair is fine.
export const MIN_PASSWORD_LENGTH = 8;

export function checkNewPassword(password, confirm) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) return 'The two passwords do not match.';
  return '';
}
