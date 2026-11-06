import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { planTransition } from '@/lib/visitFlow';

export const dynamic = 'force-dynamic';

// Body: { action: 'on_the_way' | 'started' | 'finished', minutes?: 10..60 }
// Techs may only act on their own visits. Office and owner may act on any visit.
// Uses the service role so a tech never needs write access to visits or jobs.
export async function POST(request, { params }) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const admin = getAdmin();

  const { data: visit } = await admin.from('job_visits').select('*').eq('id', params.id).maybeSingle();
  if (!visit) return NextResponse.json({ error: 'Visit not found.' }, { status: 404 });
  if (auth.staff.role === 'tech' && visit.tech_id !== auth.staff.id) {
    return NextResponse.json({ error: 'This visit is not assigned to you.' }, { status: 403 });
  }

  const { data: job } = await admin.from('jobs').select('id,status,customer_id').eq('id', visit.job_id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  if (['closed', 'cancelled'].includes(job.status)) {
    return NextResponse.json({ error: `This job is ${job.status}.` }, { status: 409 });
  }

  const { count: othersActive } = await admin
    .from('job_visits')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', visit.job_id)
    .neq('id', visit.id)
    .in('status', ['scheduled', 'on_the_way', 'started']);

  const plan = planTransition({ visit, action: body.action, minutes: body.minutes, othersActive: othersActive || 0 });
  if (plan.error) return NextResponse.json({ error: plan.error }, { status: 400 });

  // Only apply if the visit is still in the status we planned from (guards double taps).
  const { data: updated, error } = await admin
    .from('job_visits')
    .update(plan.visitPatch)
    .eq('id', visit.id)
    .eq('status', visit.status)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: 'This visit just changed. Refresh and try again.' }, { status: 409 });

  await admin.from('jobs').update(plan.jobPatch).eq('id', job.id);
  if (plan.touchCustomerLastVisit) {
    await admin.from('customers').update({ last_visit_at: plan.touchCustomerLastVisit }).eq('id', job.customer_id);
  }
  await admin.from('job_events').insert({
    job_id: job.id,
    actor_id: auth.staff.id,
    actor_email: auth.staff.email,
    kind: plan.eventKind,
    details: plan.eventDetails,
  });

  return NextResponse.json({ ok: true, visit: updated, jobStatus: plan.jobPatch.status });
}
