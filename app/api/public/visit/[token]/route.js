import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { isUuid } from '@/lib/jobDocs';
import { landingStatus } from '@/lib/onTheWay';
import { rescheduleStatus, rescheduleNote } from '@/lib/reschedule';
import { displayPhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

// The customer's status page for one visit, found by its secret token. Returns the business, the step the visit is at,
// the expected time and the job address. Never a staff name, note, price or photo.
export async function GET(request, { params }) {
  const token = params.token;
  if (!isUuid(token)) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });
  const admin = getAdmin();
  const { data: v } = await admin.from('job_visits').select('id,job_id,status,minutes_out,on_the_way_at,starts_at,eta_live,reschedule_count').eq('share_token', token).maybeSingle();
  if (!v) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });
  const [{ data: job }, { data: settings }] = await Promise.all([
    admin.from('jobs').select('job_number,job_type,address:addresses(street,unit,city,state,zip)').eq('id', v.job_id).maybeSingle(),
    admin.from('settings').select('business_name,phone,email,logo_path,timezone,reschedule_enabled,reschedule_notice_hours,reschedule_max').eq('id', 1).maybeSingle(),
  ]);
  const st = landingStatus(v, { timeZone: settings?.timezone || undefined });
  const rs = rescheduleStatus({ visit: v, jobType: job?.job_type, settings: settings || {} });
  // Only a visit that could be moved says anything about it, and only when the switch is on.
  const reschedule = settings?.reschedule_enabled && v.status === 'scheduled' && job?.job_type === 'floor_cleaning'
    ? { allowed: rs.allowed, note: rescheduleNote(rs, displayPhone(settings.phone)) }
    : null;
  return NextResponse.json({
    business: { business_name: settings?.business_name || '', phone: settings?.phone || '', email: settings?.email || '', logo_path: settings?.logo_path || null },
    status: st,
    starts_at: v.starts_at,
    time_zone: settings?.timezone || null,
    job: job ? { address: job.address } : null,
    reschedule,
  }, { headers: NO_STORE });
}
