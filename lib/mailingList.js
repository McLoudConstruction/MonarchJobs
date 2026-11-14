// A mailing list of past customers for postcards: who was last serviced between two ages, with a mailing address.
// Customers who opted out of reminders and mailings are never included. Pure, so it can be tested.
import { addMonths, dateInTz } from './outreach.js';

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

export const MAILING_HEADER = ['Name', 'Street', 'Unit', 'City', 'State', 'Zip', 'Last service', 'Months since', 'Type'];

// customers: [{ display_name, customer_type, last_visit_at, marketing_opt_out, archived, addresses: [{ street, unit, city, state, zip, created_at }] }]
// opts: { fromMonths, toMonths, types: ['residential', ...] | null }  (serviced between toMonths and fromMonths ago)
export function mailingRows(customers, { fromMonths = 11, toMonths = 14, types = null, now = new Date(), tz = 'America/Chicago' } = {}) {
  const today = dateInTz(now, tz);
  const newest = addMonths(today, -fromMonths); // serviced on or before this day
  const oldest = addMonths(today, -toMonths);   // and on or after this day
  const rows = [];
  for (const c of customers) {
    if (c.marketing_opt_out || c.archived || !c.last_visit_at) continue;
    if (types && types.length && !types.includes(c.customer_type)) continue;
    const last = dateInTz(c.last_visit_at, tz);
    if (last > newest || last < oldest) continue;
    const addr = [...(c.addresses || [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).find((a) => String(a.street || '').trim());
    if (!addr) continue;
    const [y, m] = last.split('-').map(Number);
    const [ty, tm] = today.split('-').map(Number);
    rows.push([c.display_name, addr.street, addr.unit || '', addr.city || '', addr.state || '', addr.zip || '', last, (ty - y) * 12 + (tm - m), c.customer_type]);
  }
  return rows.sort((a, b) => String(a[6]).localeCompare(String(b[6])) || String(a[0]).localeCompare(String(b[0])));
}
