import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { planTransition } from '@/lib/visitFlow';
import { siteUrl } from '@/lib/integrations';
import { sendAftercare } from '@/lib/aftercareServer';
import { advancePlan } from '@/lib/outreach';

export const dynamic = 'force-dynamic';

// For a replayed tap: the visit states that mean the step (or a later one) has already happened.
const ALREADY_PAST = { on_the_way: ['started', 'finished'], started: ['started', 'finished'], finished: ['finished'] };

// Body: { action: 'on_the_way' | 'started' | 'finished', minutes?: 10..60, at?: ISO time, op_id?: uuid, replay?: true }
// A tap made with no signal is sent later with `at` (when it really happened) and `op_id`, so a retry is applied once.
// With `replay`, a step the visit has already moved past answers 409 { code: 'STALE' } instead of an error.
// Techs may only act on their own visits. Office and owner may act on any visit.
// Uses the service role so a tech never needs write access to visits or jobs.
export async function POST(request, { params }) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const admin = getAdmin();
  const opId = typeof body.op_id === 'string' && /^[0-9a-f-]{8,64}$/i.test(body.op_id) ? body.op_id : null;
  // the time the tap really happened: accepted if it is not in the future and not older than 3 days
  const at = new Date(body.at);
  const now = new Date();
  const when = Number.isFinite(at.getTime()) && at.getTime() <= now.getTime() + 5 * 60 * 1000 && at.getTime() >= now.getTime() - 3 * 24 * 3600 * 1000 ? (at > now ? now : at) : now;

  const { data: visit } = await admin.from('job_visits').select('*').eq('id', params.id).maybeSingle();
  if (!visit) return NextResponse.json({ error: 'Visit not found.' }, { status: 404 });
  if (auth.staff.role === 'tech' && visit.tech_id !== auth.staff.id) {
    return NextResponse.json({ error: 'This visit is not assigned to you.' }, { status: 403 });
  }

  if (opId) {
    // already applied (the phone did not hear back the first time)
    const { count: seen } = await admin.from('job_events').select('id', { count: 'exact', head: true }).eq('job_id', visit.job_id).contains('details', { op_id: opId });
    if (seen) return NextResponse.json({ ok: true, duplicate: true });
  }

  const { data: job } = await admin.from('jobs').select('id,status,customer_id').eq('id', visit.job_id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  if (['closed', 'cancelled'].includes(job.status)) {
    return NextResponse.json({ error: `This job is ${job.status}.`, code: 'JOB_CLOSED' }, { status: 409 });
  }

  const { count: othersActive } = await admin
    .from('job_visits')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', visit.job_id)
    .neq('id', visit.id)
    .in('status', ['scheduled', 'on_the_way', 'started']);

  const plan = planTransition({ visit, action: body.action, minutes: body.minutes, othersActive: othersActive || 0, now: when });
  if (plan.error) {
    if (body.replay && ALREADY_PAST[body.action]?.includes(visit.status)) return NextResponse.json({ error: plan.error, code: 'STALE' }, { status: 409 });
    return NextResponse.json({ error: plan.error }, { status: 400 });
  }

  // Only apply if the visit is still in the status we planned from (guards double taps).
  const { data: updated, error } = await admin
    .from('job_visits')
    .update(plan.visitPatch)
    .eq('id', visit.id)
    .eq('status', visit.status)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: 'This visit just changed. Refresh and try again.', code: 'CHANGED' }, { status: 409 });

  await admin.from('jobs').update(plan.jobPatch).eq('id', job.id);
  if (plan.touchCustomerLastVisit) {
    await admin.from('customers').update({ last_visit_at: plan.touchCustomerLastVisit }).eq('id', job.customer_id);
  }
  await admin.from('job_events').insert({
    job_id: job.id,
    actor_id: auth.staff.id,
    actor_email: auth.staff.email,
    kind: plan.eventKind,
    details: opId ? { ...plan.eventDetails, op_id: opId, at: when.toISOString() } : plan.eventDetails,
  });

  // When the whole job is finished: move a recurring plan to its next date and send the care instructions.
  // Neither can make the finish fail.
  if (plan.touchCustomerLastVisit && plan.jobPatch.status === 'completed') {
    try {
      const [{ data: plans }, { data: st }] = await Promise.all([
        admin.from('service_plans').select('id,status,next_due,interval_months').eq('customer_id', job.customer_id).eq('status', 'active'),
        admin.from('settings').select('timezone,aftercare_auto').eq('id', 1).maybeSingle(),
      ]);
      for (const p of plans || []) {
        const next = advancePlan(p, plan.touchCustomerLastVisit, st?.timezone || undefined);
        if (next) await admin.from('service_plans').update({ next_due: next }).eq('id', p.id);
      }
      if (st?.aftercare_auto !== false) await sendAftercare({ admin, jobId: job.id, origin: siteUrl(request) });
    } catch {
      /* the visit is already saved */
    }
  }

  return NextResponse.json({ ok: true, visit: updated, jobStatus: plan.jobPatch.status });
}
