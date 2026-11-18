import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID } from '@/lib/invoiceServer';
import { openSession, openSessionFor, closeSession } from '@/lib/clockServer';

export const dynamic = 'force-dynamic';

// Clock out and back in on a job (lunch, a break). Starting and finishing the job already run the clock, so this is only for
// the gap in the middle.
// Body: { action: 'out' | 'in', staff_id? }. A tech works their own clock. Office and owner may stop someone's forgotten clock
// by passing staff_id with 'out'. 'in' needs the person's visit to be under way ("Start job" already tapped).
export async function POST(request, { params }) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const admin = getAdmin();
  const office = auth.staff.role !== 'tech';
  const who = office && body.action === 'out' && UUID.test(String(body.staff_id || '')) ? body.staff_id : auth.staff.id;

  const { data: job } = await admin.from('jobs').select('id,status').eq('id', params.id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  if (['closed', 'cancelled'].includes(job.status)) return NextResponse.json({ error: `This job is ${job.status}.` }, { status: 409 });

  const now = new Date();
  const open = await openSessionFor(admin, job.id, who);
  try {
    if (body.action === 'out') {
      if (!open) return NextResponse.json({ error: 'The clock is not running.' }, { status: 409 });
      const s = await closeSession(admin, open, now);
      return NextResponse.json({ ok: true, session: s });
    }
    if (body.action === 'in') {
      if (open) return NextResponse.json({ error: 'The clock is already running.' }, { status: 409 });
      const { data: visit } = await admin.from('job_visits').select('id').eq('job_id', job.id).eq('tech_id', who).eq('status', 'started').maybeSingle();
      if (!visit) return NextResponse.json({ error: 'Tap Start job first. The clock starts with it.' }, { status: 409 });
      const s = await openSession(admin, { jobId: job.id, visitId: visit.id, staffId: who, at: now, source: 'manual' });
      return NextResponse.json({ ok: true, session: s });
    }
  } catch (e) {
    return NextResponse.json({ error: /duplicate|unique/i.test(e.message) ? 'The clock is already running.' : e.message }, { status: 409 });
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
