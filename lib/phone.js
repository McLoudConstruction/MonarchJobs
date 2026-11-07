// US phone numbers shown as (xxx) xxx-xxxx while typing.

export function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

// Formats as the person types. A leading country code 1 is dropped only when there are more than
// ten digits (a pasted "+1 816 555 1212"), so typing a number that starts with 1 still works.
// The closing bracket and dash only appear once a digit follows them, which keeps backspace usable.
export function formatPhone(value) {
  let d = digitsOnly(value);
  if (d.length > 10 && d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// For display: formats complete numbers, leaves anything else (extensions, international) as entered.
export function displayPhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  let d = digitsOnly(raw);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? formatPhone(d) : raw;
}

// Value for a tel: link.
export function telHref(value) {
  const d = digitsOnly(value);
  return d ? `tel:${d.length === 10 ? '+1' : '+'}${d}` : '';
}

// +1XXXXXXXXXX for texting providers, or null when it is not a usable US number.
export function toE164(value) {
  let d = digitsOnly(value);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? `+1${d}` : null;
}
