// What the new-lead form sends to search_customers (migration 012) while the office types.
// Returns null until there is enough typed to be worth a lookup: two letters of a name, four digits
// of a phone, or three characters of an email.
import { digitsOnly } from './phone.js';

export function customerSearchArgs(v) {
  const name = String(v?.company_name || '').trim() || [v?.first_name, v?.last_name].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
  const phone = digitsOnly(v?.phone);
  const email = String(v?.email || '').trim();
  const args = {
    p_name: name.length >= 2 ? name : '',
    p_phone: phone.length >= 4 ? phone : '',
    p_email: email.length >= 3 ? email : '',
  };
  return args.p_name || args.p_phone || args.p_email ? args : null;
}
