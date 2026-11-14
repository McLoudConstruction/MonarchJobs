import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { cleanRequest } from '@/lib/customerPage';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Request a visit" or "Ask about a plan": becomes a new lead for the office (which also notifies them).
// Only one request per customer per day.
export async function POST(request, { params }) {
  if (!UUID.test(params.token)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const checked = cleanRequest(body);
  if (checked.error) return NextResponse.json({ error: checked.error }, { status: 400 });

  const admin = getAdmin();
  const { data: job } = await admin
    .from('jobs')
    .select('id,customer_id,address:addresses(street,unit,city,state,zip,gate_code,warnings),customer:customers(first_name,last_name,company_name,phone,email,customer_type)')
    .eq('customer_token', params.token)
    .maybeSingle();
  if (!job || !job.customer) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from('leads').select('id', { count: 'exact', head: true }).eq('customer_id', job.customer_id).eq('source', 'web').gte('created_at', since);
  if (count) return NextResponse.json({ ok: true, duplicate: true });

  const c = job.customer;
  const a = job.address || {};
  const { value } = checked;
  const { error } = await admin.from('leads').insert({
    source: 'web',
    customer_id: job.customer_id,
    customer_type: c.customer_type || 'residential',
    first_name: c.first_name || '', last_name: c.last_name || '', company_name: c.company_name || '',
    phone: c.phone || '', email: c.email || '',
    street: a.street || '', unit: a.unit || '', city: a.city || '', state: a.state || 'MO', zip: a.zip || '',
    gate_code: a.gate_code || '', warnings: a.warnings || '',
    job_type: 'floor_cleaning',
    service_requested: value.kind === 'plan'
      ? `Customer asked about a regular cleaning plan (every ${value.interval_months} month${value.interval_months === 1 ? '' : 's'}).`
      : 'Customer asked for another cleaning from their care page.',
    preferred_times: value.preferred_times,
    intake: { from: 'customer_page', ...(value.kind === 'plan' ? { plan_interval_months: value.interval_months } : {}) },
  });
  if (error) return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  await admin.from('job_events').insert({ job_id: job.id, kind: 'customer_requested', details: { request: value.kind, interval_months: value.interval_months } });
  return NextResponse.json({ ok: true });
}
