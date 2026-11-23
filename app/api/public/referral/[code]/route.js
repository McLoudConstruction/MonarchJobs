import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { findReferrer } from '@/lib/referralServer';
import { cleanReferralForm, referralCredit, MAX_PER_PHONE_PER_DAY, MAX_PER_HOUR } from '@/lib/referral';

export const dynamic = 'force-dynamic';

async function load(admin, code) {
  const { data: settings } = await admin.from('settings').select('business_name,phone,email,logo_path,referral_enabled').eq('id', 1).maybeSingle();
  if (!settings?.referral_enabled) return null;
  const referrer = await findReferrer(admin, code);
  if (!referrer) return null;
  return { settings, referrer };
}

// The page a friend opens from a shared link. It shows the business only: the friend never sees who sent it.
export async function GET(request, { params }) {
  const admin = getAdmin();
  const found = await load(admin, params.code);
  if (!found) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const s = found.settings;
  return NextResponse.json({ business: { name: s.business_name || '', phone: s.phone || '', email: s.email || '', logo_path: s.logo_path || null } });
}

// The friend asks for a quote: a new lead tagged "referral". It counts toward a reward only when the friend is not the
// referrer and not already a customer.
export async function POST(request, { params }) {
  const admin = getAdmin();
  const found = await load(admin, params.code);
  if (!found) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const checked = cleanReferralForm(body);
  if (checked.error) return NextResponse.json({ error: checked.error }, { status: 400 });
  const f = checked.value;
  if (f.honeypot) return NextResponse.json({ ok: true }); // a robot: look like it worked, save nothing

  const now = Date.now();
  const sinceDay = new Date(now - 86400000).toISOString();
  const sinceHour = new Date(now - 3600000).toISOString();
  const tag = { from: 'referral' };
  const [byPhone, lastHour] = await Promise.all([
    f.phone ? admin.from('leads').select('id', { count: 'exact', head: true }).contains('intake', tag).eq('phone', f.phone).gte('created_at', sinceDay) : { count: 0 },
    admin.from('leads').select('id', { count: 'exact', head: true }).contains('intake', tag).gte('created_at', sinceHour),
  ]);
  if ((byPhone.count || 0) >= MAX_PER_PHONE_PER_DAY || (lastHour.count || 0) >= MAX_PER_HOUR) {
    return NextResponse.json({ error: 'We have received a lot of requests from this number or network. Please call us.' }, { status: 429 });
  }

  const { data: matches } = await admin.rpc('find_customer_matches', { p_phone: f.phone, p_email: f.email });
  const ids = (matches || []).map((m) => m.id);
  const credit = referralCredit({ referrerId: found.referrer.id, matches: ids });

  const { data: lead, error } = await admin.from('leads').insert({
    source: 'referral',
    status: 'new',
    customer_type: 'residential',
    customer_id: ids.length === 1 ? ids[0] : null,
    first_name: f.first_name, last_name: f.last_name, phone: f.phone, email: f.email,
    street: f.street, zip: f.zip, state: 'MO',
    job_type: 'floor_cleaning',
    service_requested: 'A friend sent them. Asked for a quote.',
    notes: f.notes,
    intake: { ...tag },
    referred_by: credit.credit || credit.reason === 'existing_customer' ? found.referrer.id : null,
  }).select('id').single();
  if (error || !lead) {
    console.error('referral: lead insert failed:', error?.message);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
  if (credit.credit) {
    const { error: rerr } = await admin.from('referrals').insert({ lead_id: lead.id, referrer_id: found.referrer.id });
    if (rerr) console.error('referral: row insert failed:', rerr.message);
  }
  return NextResponse.json({ ok: true });
}
