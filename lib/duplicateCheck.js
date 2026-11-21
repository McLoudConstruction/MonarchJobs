// Duplicate check while a lead is typed in (push 1A, #9). The lookup itself is the database function
// find_duplicate_customers (migration 040); this decides when to ask and how to word what comes back.
import { digitsOnly } from './phone.js';

// The same steps as public.norm_street_full in migration 040 (tests/duplicateCheck.test.mjs keeps them in agreement):
// "123 N. Main Street" and "123 north main st" become the same text.
const SWAPS = [
  ['street', 'st'], ['avenue', 'ave'], ['road', 'rd'], ['drive', 'dr'], ['lane', 'ln'], ['court', 'ct'], ['boulevard', 'blvd'],
  ['place', 'pl'], ['circle', 'cir'], ['north', 'n'], ['south', 's'], ['east', 'e'], ['west', 'w'],
];
export function normStreet(street) {
  let v = String(street ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  for (const [from, to] of SWAPS) v = v.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  return v.replace(/\s+/g, '');
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// What to send to find_duplicate_customers, or null when there is not yet enough typed to be worth asking:
// ten digits of a phone, a whole email, or a street with a zip (or a city).
export function duplicateArgs(v) {
  const phone = digitsOnly(v?.phone);
  const email = String(v?.email || '').trim();
  const street = String(v?.street || '').trim();
  const zip = String(v?.zip || '').replace(/\D/g, '').slice(0, 5);
  const city = String(v?.city || '').trim();
  const args = {
    p_phone: phone.length >= 10 ? phone : '',
    p_email: EMAIL.test(email) ? email : '',
    p_street: normStreet(street).length >= 4 && (zip.length === 5 || city.length >= 2) ? street : '',
    p_unit: String(v?.unit || '').trim(),
    p_city: city,
    p_zip: zip,
  };
  return args.p_phone || args.p_email || args.p_street ? args : null;
}

// A stable text for the arguments, so the screen only asks again when something relevant changed.
export const duplicateKey = (args) => (args ? JSON.stringify(args) : '');

export function reasonText(m) {
  const r = [m.same_phone && 'phone number', m.same_email && 'email', m.same_address && 'address'].filter(Boolean);
  if (!r.length) return '';
  return `Same ${r.length === 1 ? r[0] : `${r.slice(0, -1).join(', ')} and ${r[r.length - 1]}`}`;
}

// One line for the banner. A customer can be used to fill in the form; an open lead is opened instead.
export function bannerText(m) {
  const why = reasonText(m);
  return m.kind === 'lead' ? `Open lead for ${m.display_name || 'someone'}. ${why}.` : `${m.display_name} is already a customer. ${why}.`;
}

// Matches the office has not dismissed, customers first. dismissed: Set of `${kind}:${id}`.
export function visibleMatches(matches, dismissed = new Set()) {
  return (matches || []).filter((m) => !dismissed.has(`${m.kind}:${m.id}`));
}
