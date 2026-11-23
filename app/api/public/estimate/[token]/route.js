import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { isExpired, validThrough } from '@/lib/estimateExpiry';
import { optionalStaff } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Customer-facing estimate, found by its secret link. Draft estimates are not visible.
// Internal notes and staff details are never returned. A view is recorded unless ?preview=1.
// Signed-in staff can preview a draft (?preview=1 with their login token) to see what the customer will see before it is sent.
export async function GET(request, { params }) {
  const token = params.token;
  if (!UUID.test(token)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const admin = getAdmin();
  const { data: est } = await admin
    .from('estimates')
    .select('id,job_id,lead_id,status,minimum_charge,chosen_tier,sent_at,first_viewed_at,view_count,expires_at,followups_paused')
    .eq('share_token', token)
    .maybeSingle();
  const preview = new URL(request.url).searchParams.get('preview') === '1';
  let staffPreview = false;
  if (preview && est?.status === 'draft') { const who = await optionalStaff(request); staffPreview = !!who.staff; }
  if (!est || (est.status === 'draft' && !staffPreview)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  if (!preview) {
    const now = new Date().toISOString();
    await admin
      .from('estimates')
      .update({ first_viewed_at: est.first_viewed_at ?? now, last_viewed_at: now, view_count: (est.view_count || 0) + 1 })
      .eq('id', est.id);
  }

  // Before a work order exists the estimate belongs to the lead; afterwards to the job.
  const subject = est.job_id
    ? admin.from('jobs').select('job_number,job_type,customer_notes,customer:customers(display_name),address:addresses(street,unit,city,state,zip)').eq('id', est.job_id).maybeSingle()
    : admin.from('leads').select('name,job_type,street,unit,city,state,zip,status,intake').eq('id', est.lead_id).maybeSingle();
  const [{ data: lines }, { data: found }, { data: settings }] = await Promise.all([
    admin.from('estimate_lines').select('id,description,unit,quantity,unit_price,tier,optional,accepted,sort_order,created_at').eq('estimate_id', est.id).order('sort_order').order('created_at'),
    subject,
    admin.from('settings').select('business_name,phone,email,logo_path,timezone,booking_after_sign').eq('id', 1).maybeSingle(),
  ]);
  const job = !found ? null : est.job_id
    ? found
    : {
        job_number: null, job_type: found.job_type, customer_notes: '', customer: { display_name: found.name },
        address: { street: found.street, unit: found.unit, city: found.city, state: found.state, zip: found.zip },
      };

  let signed = null;
  if (est.status === 'approved') {
    const { data: sig } = await admin.from('estimate_signatures').select('signer_name,signed_at').eq('estimate_id', est.id).order('signed_at', { ascending: false }).limit(1);
    signed = sig?.[0] || null;
  }

  // Picking a time online: offered while the estimate is still a lead with an address. An estimate that already has a
  // work order shows its appointment instead.
  const onLead = !est.job_id && !!found;
  const selfSchedule = onLead && !!String(found.street || '').trim() && (settings?.booking_after_sign !== false || !!found.intake?.booking);
  let appointment = null;
  if (est.job_id) {
    const { data: visit } = await admin.from('job_visits').select('starts_at,ends_at').eq('job_id', est.job_id).in('status', ['scheduled', 'on_the_way', 'started']).order('starts_at').limit(1);
    appointment = visit?.[0] || null;
  }

  // A restoration estimate can carry a "valid through" date (Settings > Outreach). Past it, it can no longer be approved online.
  const tz = settings?.timezone || 'America/Chicago';
  const expired = isExpired(est);
  return NextResponse.json({
    status: est.status,
    draft: est.status === 'draft',
    can_accept: (est.status === 'sent' || staffPreview) && !expired, // a staff preview of a draft shows the options and the approve section too (the accept route still needs a sent estimate)
    expired,
    valid_through: est.status === 'sent' ? validThrough(est.expires_at, tz) : null,
    reminders_stopped: !!est.followups_paused,
    can_stop_reminders: est.status === 'sent' && !est.followups_paused,
    self_schedule: selfSchedule,
    can_schedule: selfSchedule && est.status === 'approved' && found.status === 'accepted',
    appointment,
    timezone: settings?.timezone || 'America/Chicago',
    signed,
    minimum_charge: est.minimum_charge,
    chosen_tier: est.chosen_tier,
    lines: lines || [],
    job: job ? { job_number: job.job_number, job_type: job.job_type, customer_notes: job.customer_notes, customer: job.customer?.display_name, address: job.address } : null,
    business: settings || {},
  });
}
