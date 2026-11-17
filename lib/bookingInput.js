// Checks and tidies what the booking page sends. Pure, so the server route stays thin and this can be tested.
import { digitsOnly, formatPhone, toE164 } from './phone.js';
import { BOOKING_KINDS } from './booking.js';

const PNG_PREFIX = 'data:image/png;base64,';
const MAX_SIGNATURE_CHARS = 400000;
const PNG_MAGIC = '89504e470d0a1a0a';
export const SIGNATURE_ERROR = 'Please sign in the box.';

// null when the signature is a real PNG of a sensible size, otherwise the message to show.
export function checkSignature(signature) {
  const s = String(signature || '');
  if (!s.startsWith(PNG_PREFIX) || s.length > MAX_SIGNATURE_CHARS) return SIGNATURE_ERROR;
  let bytes;
  try {
    bytes = Buffer.from(s.slice(PNG_PREFIX.length), 'base64');
  } catch {
    return SIGNATURE_ERROR;
  }
  return bytes.subarray(0, 8).toString('hex') === PNG_MAGIC ? null : SIGNATURE_ERROR;
}

const tidy = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Returns { value } or { error }. `staff` is true only when the server has verified a signed-in staff member:
// the job kind and "schedule later" are for them, everyone else is a carpet customer.
export function cleanBookingBody(body = {}, { staff = false } = {}) {
  const name = tidy(body.name, 120);
  if (name.length < 2) return { error: 'Please type your full name.' };
  const sigError = checkSignature(body.signature);
  if (sigError) return { error: sigError };

  const c = body.customer || {};
  const a = body.address || {};
  const first = tidy(c.first_name, 60);
  const last = tidy(c.last_name, 60);
  if (!first && !last) return { error: 'Please enter your name.' };
  if (!toE164(c.phone)) return { error: 'Please enter a phone number we can reach (10 digits).' };
  const email = tidy(c.email, 120);
  if (email && !EMAIL.test(email)) return { error: 'That email address does not look right.' };

  const street = tidy(a.street, 120);
  const city = tidy(a.city, 60);
  const state = tidy(a.state, 2).toUpperCase() || 'MO';
  if (street.length < 3) return { error: 'Please enter the street address for the job.' };
  if (!city) return { error: 'Please enter the city.' };
  if (!/^[A-Z]{2}$/.test(state)) return { error: 'Please enter the state as two letters, like MO.' };

  const later = !!body.later;
  const slot = later ? null : String(body.slot || '');
  if (!later && !Number.isFinite(new Date(slot).getTime())) return { error: 'Please pick a time, or ask us to call you to schedule.' };

  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40).map((i) => ({ id: String(i?.id || ''), quantity: i?.quantity }));

  return {
    value: {
      signerName: name,
      signature: String(body.signature),
      kind: staff && BOOKING_KINDS.includes(body.kind) ? body.kind : 'carpet',
      first_name: first,
      last_name: last,
      phone: formatPhone(digitsOnly(c.phone)),
      email,
      street,
      unit: tidy(a.unit, 30),
      city,
      state,
      zip: tidy(a.zip, 10),
      gate_code: tidy(a.gate_code, 60),
      warnings: tidy(a.warnings, 300),
      notes: String(body.notes ?? '').trim().slice(0, 1000),
      slot,
      later,
      items,
      honeypot: String(body.hp ?? '').trim(),
    },
  };
}

// The lead fields a booking writes. Carpet is floor cleaning; the others are the restoration types.
export function leadFieldsFor(kind) {
  return kind === 'carpet'
    ? { job_type: 'floor_cleaning', restoration_type: null }
    : { job_type: 'water_restoration', restoration_type: kind };
}
