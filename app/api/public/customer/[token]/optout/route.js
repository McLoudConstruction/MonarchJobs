import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Stop reminders": the customer turns off reminders and mailings, or turns them back on.
export async function POST(request, { params }) {
  if (!UUID.test(params.token)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const admin = getAdmin();
  const { data: job } = await admin.from('jobs').select('id,customer_id').eq('customer_token', params.token).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const out = body.opt_out !== false;
  const { error } = await admin.from('customers').update({ marketing_opt_out: out }).eq('id', job.customer_id);
  if (error) return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  return NextResponse.json({ ok: true, opted_out: out });
}
