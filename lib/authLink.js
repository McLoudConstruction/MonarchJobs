// When an emailed link (invite, reset) is expired or already used, Supabase sends the person back
// to the app with the problem in the address, e.g.
//   #error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
// Pass window.location.hash or .search. Returns { code, description } or null when there is no error.
export function parseAuthLinkError(hashOrSearch) {
  const raw = String(hashOrSearch || '').replace(/^[#?]/, '');
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  const code = p.get('error_code') || p.get('error');
  if (!code) return null;
  return { code, description: p.get('error_description') || '' };
}
