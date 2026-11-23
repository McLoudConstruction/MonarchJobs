// Server only. Share codes and the lookup behind the public referral page.
import { makeCode, cleanCode } from './referral.js';

// The customer's code, made the first time it is needed. A code collision is retried.
export async function ensureReferralCode(admin, customerId) {
  const { data: cur } = await admin.from('customers').select('referral_code').eq('id', customerId).maybeSingle();
  if (!cur) return null;
  if (cur.referral_code) return cur.referral_code;
  for (let i = 0; i < 6; i += 1) {
    const code = makeCode();
    const { data, error } = await admin.from('customers').update({ referral_code: code }).eq('id', customerId).is('referral_code', null).select('referral_code').maybeSingle();
    if (data?.referral_code) return data.referral_code;
    if (!error) {
      // someone else set it in between
      const { data: again } = await admin.from('customers').select('referral_code').eq('id', customerId).maybeSingle();
      if (again?.referral_code) return again.referral_code;
    }
  }
  return null;
}

export async function findReferrer(admin, rawCode) {
  const code = cleanCode(rawCode);
  if (!code) return null;
  const { data } = await admin.from('customers').select('id,archived').eq('referral_code', code).maybeSingle();
  return data && !data.archived ? { id: data.id, code } : null;
}
