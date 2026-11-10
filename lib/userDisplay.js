// How a signed-in staff member is shown in the app: the initials on the
// account button and the name at the top of its menu.
//
// Every staff member should have a name saved. A blank value, or one that
// looks like an email, is treated as "no name yet": the app asks that person
// for it (see NameGate) and the owner can set it in Settings > Users.

function looksLikeEmail(s) {
  return typeof s === 'string' && s.includes('@');
}

function nameWords(fullName) {
  if (!fullName || !fullName.trim() || looksLikeEmail(fullName)) return [];
  return fullName.trim().split(/\s+/).filter(Boolean);
}

// "pat.lee@x.com" -> ["Pat", "Lee"], "pat@x.com" -> ["Pat"]
function emailWords(email) {
  const local = (email || '').split('@')[0] || '';
  return local.split(/[._\-+\s]+/).filter(w => /[a-z]/i.test(w));
}

function cap(word) {
  return word ? word[0].toUpperCase() + word.slice(1) : '';
}

// First and last initial ("Stachys McLoud" -> "SM"). A single word gives one
// letter. Middle names are skipped, so "Mary Ann Smith" -> "MS".
export function initialsFor(fullName, email) {
  let words = nameWords(fullName);
  if (!words.length) words = emailWords(email);
  if (!words.length) return '';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Full name for display. Falls back to a tidied version of the email's first
// part, then to the raw email.
export function displayNameFor(fullName, email) {
  const words = nameWords(fullName);
  if (words.length) return words.join(' ');
  const fromEmail = emailWords(email).map(cap).join(' ');
  return fromEmail || email || '';
}

// True when a real name is saved (not blank, not an email address).
export function hasRealName(fullName) {
  return nameWords(fullName).length > 0;
}

// Name for a staff row ({ full_name, email }), for lists and dropdowns.
export function staffName(staff) {
  return staff ? displayNameFor(staff.full_name, staff.email) : '';
}
