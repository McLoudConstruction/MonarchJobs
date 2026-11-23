// Referral program (push 1C, #21): a customer shares a link, the friend asks for a quote, the owner marks the reward paid.
// Pure rules, so they can be tested. The server (lib/referralServer.js and the /api/public/referral routes) does the saving.

// No 0, O, 1, I or L, so a code read aloud or typed from a card is not mistaken.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
export const MAX_REWARD_TEXT = 160;
export const MAX_PER_PHONE_PER_DAY = 3;
export const MAX_PER_HOUR = 25;

export function makeCode(random = Math.random, length = CODE_LENGTH) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return out;
}

// What someone typed or what is in a link: letters and digits only, upper case. '' when it cannot be a code.
export function cleanCode(value) {
  const s = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length >= 6 && s.length <= 12 ? s : '';
}

export const referralLink = (origin, code) => `${String(origin || '').replace(/\/+$/, '')}/r/${code}`;

const digits = (s) => String(s ?? '').replace(/\D/g, '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// The friend's form. A name and a way to reach them are required; the rest is optional.
export function cleanReferralForm(body) {
  const first = String(body?.first_name ?? '').trim().slice(0, 60);
  const last = String(body?.last_name ?? '').trim().slice(0, 60);
  if (!first) return { error: 'Please enter your first name.' };
  const phoneDigits = digits(body?.phone);
  const email = String(body?.email ?? '').trim().toLowerCase().slice(0, 120);
  if (phoneDigits && phoneDigits.length < 10) return { error: 'That phone number looks too short.' };
  if (!phoneDigits && !email) return { error: 'Please enter a phone number or an email so we can reach you.' };
  if (email && !EMAIL.test(email)) return { error: 'That email address does not look right.' };
  return {
    value: {
      first_name: first,
      last_name: last,
      phone: phoneDigits ? phoneDigits.slice(-10) : '',
      email,
      street: String(body?.street ?? '').trim().slice(0, 120),
      zip: String(body?.zip ?? '').replace(/[^\d-]/g, '').slice(0, 10),
      notes: String(body?.notes ?? '').trim().slice(0, 500),
      honeypot: !!String(body?.website ?? '').trim(),
    },
  };
}

// Does this friend earn the referrer a reward? Not when the friend is the referrer, and not when the friend is already a customer.
// matches: customer ids found for the friend's phone or email.
export function referralCredit({ referrerId, matches = [] }) {
  if (!referrerId) return { credit: false, reason: 'no_referrer' };
  if (matches.includes(referrerId)) return { credit: false, reason: 'self' };
  if (matches.length > 0) return { credit: false, reason: 'existing_customer' };
  return { credit: true, reason: '' };
}

export const REASON_LABELS = {
  self: 'The friend is the same person as the referrer.',
  existing_customer: 'The friend is already a customer.',
};

// waiting: the friend has not had a finished job yet. earned: a job is finished and the reward is owed. paid: the owner paid it.
export function referralStatus({ voided = false, paid_at = null, jobStatus = null } = {}) {
  if (voided) return 'void';
  if (paid_at) return 'paid';
  return ['completed', 'closed'].includes(jobStatus) ? 'earned' : 'waiting';
}

export const STATUS_LABELS = { waiting: 'Waiting for the job', earned: 'Reward owed', paid: 'Paid', void: 'Not counted' };

export function summarize(rows = []) {
  const out = { waiting: 0, earned: 0, paid: 0, void: 0 };
  for (const r of rows) out[r.status] = (out[r.status] || 0) + 1;
  return out;
}

// The text a customer can send to a friend from their page.
export function shareMessage({ business, link }) {
  const biz = String(business || '').trim() || 'us';
  return `I use ${biz} for my floors and I would recommend them. Ask for a quote here: ${link}`;
}
