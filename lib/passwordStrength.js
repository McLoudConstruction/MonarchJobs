// Password strength for the meter shown while someone chooses a password.
// Pure and dependency free. score: 0 = empty, 1 Weak, 2 Fair, 3 Good, 4 Strong.
//
// Rule of thumb it encodes: length counts most, then a mix of character types.
//   8-11 characters need three kinds (lower, upper, number, symbol) to reach Fair.
//   12+ characters reach Fair with any characters, 16+ with a mix reaches Strong.
// Anything that is a common password, a repeat, a simple sequence, or contains the person's
// own name or email is held at Weak no matter how long it is.

export const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];

const COMMON = new Set([
  'password', 'passw0rd', 'passcode', 'qwerty', 'qwertyuiop', 'letmein', 'welcome', 'admin', 'administrator',
  'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'basketball', 'abc123', 'trustno1', 'changeme',
  'login', 'master', 'sunshine', 'princess', 'superman', 'batman', 'starwars', 'whatever', 'freedom',
  'summer', 'winter', 'spring', 'autumn', 'secret', 'monarch', 'monarchjobs', 'mcloud', 'mcloudjobs',
  'carpet', 'restoration', 'welcome1', 'test', 'testing', 'guest', 'default', 'hello', 'hunter',
]);

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

const LEET = { '@': 'a', '0': 'o', '$': 's', '3': 'e', '1': 'l', '!': 'i', '5': 's' };

function unLeet(s) {
  return s.replace(/[@0$31!5]/g, (c) => LEET[c]);
}

function isCommon(lower) {
  if (COMMON.has(lower)) return true;
  // "Password1!", "monarch2024", "P@ssw0rd": drop trailing digits/symbols and common letter swaps.
  const trimmed = lower.replace(/[^a-z]+$/, '');
  if (COMMON.has(trimmed)) return true;
  const plain = unLeet(lower).replace(/[^a-z]+$/, '');
  return COMMON.has(plain);
}

function isSequenceOrRepeat(lower) {
  if (new Set(lower).size < 5) return true; // "aaaaaaaa", "abababab"
  if (/^(.{1,4})\1+$/.test(lower)) return true; // "abcabcabc"
  if (lower.length >= 4) {
    for (const seq of SEQUENCES) {
      const rev = [...seq].reverse().join('');
      if (seq.includes(lower) || rev.includes(lower)) return true; // "12345678", "qwertyui", "hgfedcba"
    }
  }
  return false;
}

// Words from the person's own details (email, name) that must not be in the password: each word of
// four or more letters, and the whole name run together ("pat.lee" -> "patlee").
function contextTokens(context) {
  const tokens = [];
  for (const c of context || []) {
    const s = String(c || '').toLowerCase();
    const local = s.includes('@') ? s.split('@')[0] : s;
    for (const t of local.split(/[^a-z0-9]+/)) if (t.length >= 4) tokens.push(t);
    const joined = local.replace(/[^a-z0-9]/g, '');
    if (joined.length >= 4) tokens.push(joined);
  }
  return tokens;
}

// context: strings about the person (email, full name). Returns { score, label, tip, flagged }.
export function passwordStrength(password, context = []) {
  const pw = String(password || '');
  if (!pw) return { score: 0, label: '', tip: '', flagged: false };

  const lower = pw.toLowerCase();
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;

  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (pw.length >= 16) score += 1;
  if (classes >= 3) score += 1;

  const squashed = lower.replace(/[^a-z0-9]/g, ''); // "Pat.Lee-2026!" still contains "patlee"
  const flagged = isCommon(lower) || isSequenceOrRepeat(lower) || contextTokens(context).some((t) => lower.includes(t) || squashed.includes(t));
  if (flagged || pw.length < 8) score = Math.min(score, 1);
  score = Math.max(1, Math.min(4, score));

  let tip = '';
  if (pw.length < 8) tip = 'Use at least 8 characters.';
  else if (flagged) tip = 'Avoid common words, repeats, simple sequences and your own name or email.';
  else if (score < 4 && pw.length < 12 && classes < 3) tip = 'Longer is stronger. Try 12 or more characters, or mix in capitals, numbers and symbols.';
  else if (score < 4 && pw.length < 12) tip = 'Longer is stronger. Try 12 or more characters.';
  else if (score < 4 && classes < 3) tip = 'Mix capital and lowercase letters, numbers and symbols.';
  else if (score < 4) tip = 'A few more characters will make it strong.';

  return { score, label: STRENGTH_LABELS[score], tip, flagged };
}
