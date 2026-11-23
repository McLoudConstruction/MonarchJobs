import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { loadAftercare } from '@/lib/aftercareServer';
import { ensureReferralCode } from '@/lib/referralServer';
import { cleanInspection, latestSigned, RESULTS, NOT_REMOVED } from '@/lib/inspection';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The customer's page for a finished job, found by its secret link. Shows care instructions, the signed
// service record and their own problem reports. Staff names and internal notes are never returned.
export async function GET(request, { params }) {
  if (!UUID.test(params.token)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const admin = getAdmin();
  const { data: job } = await admin.from('jobs').select('id,job_number,job_type,status,completed_at,customer_id').eq('customer_token', params.token).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const [info, { data: settings }, { data: problems }, { data: inspections }, { data: full }] = await Promise.all([
    loadAftercare(admin, job.id),
    admin.from('settings').select('business_name,phone,email,logo_path,referral_enabled,referral_reward_text').eq('id', 1).maybeSingle(),
    admin.from('job_problem_reports').select('kind,status,created_at').eq('job_id', job.id).order('created_at', { ascending: false }).limit(10),
    admin.from('job_inspections').select('kind,data,signer_name,signed_at,customer_absent').eq('job_id', job.id).not('signed_at', 'is', null),
    admin.from('jobs').select('customer:customers(first_name,marketing_opt_out)').eq('id', job.id).maybeSingle(),
  ]);

  // The share link for "refer a friend": made the first time the page is opened, and only while the program is on.
  const referral = settings?.referral_enabled
    ? { code: await ensureReferralCode(admin, job.customer_id), reward: settings.referral_reward_text || '' }
    : null;

  const rec = (kind) => {
    const i = latestSigned(inspections || [], kind);
    if (!i) return null;
    const d = cleanInspection(kind, i.data);
    return { signed_by: i.signer_name, absent: !!i.customer_absent, signed_at: i.signed_at, room_count: d.room_count, rooms: d.rooms, notes: d.notes, drying_hours: d.drying_hours ?? null, comments: d.comments ?? '' };
  };

  return NextResponse.json({
    job: { job_number: job.job_number, job_type: job.job_type, finished: ['completed', 'closed'].includes(job.status), completed_at: job.completed_at },
    first_name: full?.customer?.first_name || '',
    opted_out: !!full?.customer?.marketing_opt_out,
    business: { business_name: settings?.business_name, phone: settings?.phone, email: settings?.email, logo_path: settings?.logo_path },
    referral: referral?.code ? referral : null,
    aftercare: { notes: info?.content?.notes || [], dry_hours: info?.content?.dryHours || null },
    before: rec('pre'),
    after: rec('post'),
    result_labels: RESULTS,
    not_removed: NOT_REMOVED,
    problems: problems || [],
  });
}
