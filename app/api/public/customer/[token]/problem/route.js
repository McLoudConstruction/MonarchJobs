import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { cleanProblem, MAX_PROBLEMS_PER_DAY } from '@/lib/customerPage';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Report a problem" from the customer page. The database tells the office. At most a few a day per job.
export async function POST(request, { params }) {
  if (!UUID.test(params.token)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const checked = cleanProblem(body);
  if (checked.error) return NextResponse.json({ error: checked.error }, { status: 400 });

  const admin = getAdmin();
  const { data: job } = await admin.from('jobs').select('id').eq('customer_token', params.token).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from('job_problem_reports').select('id', { count: 'exact', head: true }).eq('job_id', job.id).gte('created_at', since);
  if ((count || 0) >= MAX_PROBLEMS_PER_DAY) return NextResponse.json({ error: 'We already have your reports. Please call us if it is urgent.' }, { status: 429 });

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
  const { error } = await admin.from('job_problem_reports').insert({ job_id: job.id, ...checked.value, ip });
  if (error) return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  await admin.from('job_events').insert({ job_id: job.id, kind: 'problem_reported', details: { problem: checked.value.kind } });
  return NextResponse.json({ ok: true });
}
