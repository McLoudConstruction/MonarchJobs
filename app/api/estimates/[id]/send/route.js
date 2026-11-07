import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { siteUrl } from '@/lib/integrations';
import { sendSms, sendEmail } from '@/lib/notify';
import { buildEstimateMessages } from '@/lib/estimateMessages';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Texts and emails the customer a link to view and approve the estimate. Office and owner only.
// The estimate is marked Sent only when at least one message actually went out.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Estimate not found.' }, { status: 404 });

  const admin = getAdmin();
  const { data: est } = await admin
    .from('estimates')
    .select('id,job_id,lead_id,status,share_token')
    .eq('id', params.id)
    .maybeSingle();
  if (!est) return NextResponse.json({ error: 'Estimate not found.' }, { status: 404 });
  if (est.status === 'approved') return NextResponse.json({ error: 'The customer already approved this estimate.' }, { status: 409 });

  const { count } = await admin.from('estimate_lines').select('id', { count: 'exact', head: true }).eq('estimate_id', est.id);
  if (!count) return NextResponse.json({ error: 'Add at least one line before sending the estimate.' }, { status: 400 });

  // who to send to: the job's customer once there is a job, otherwise the lead
  let who = null;
  if (est.job_id) {
    const { data: job } = await admin.from('jobs').select('customer:customers(display_name,phone,email)').eq('id', est.job_id).maybeSingle();
    if (job?.customer) who = { name: job.customer.display_name, phone: job.customer.phone, email: job.customer.email };
  } else if (est.lead_id) {
    const { data: lead } = await admin.from('leads').select('name,phone,email').eq('id', est.lead_id).maybeSingle();
    if (lead) who = { name: lead.name, phone: lead.phone, email: lead.email };
  }
  if (!who) return NextResponse.json({ error: 'Could not find who to send this to.' }, { status: 404 });

  const { data: settings } = await admin.from('settings').select('business_name').eq('id', 1).maybeSingle();
  const link = `${siteUrl(request)}/e/${est.share_token}`;
  const msgs = buildEstimateMessages({ business: settings?.business_name, customerName: who.name, link, resend: est.status !== 'draft' });

  const [sms, email] = await Promise.all([
    who.phone ? sendSms({ to: who.phone, body: msgs.sms }) : { status: 'skipped', detail: 'No phone number on file.' },
    who.email ? sendEmail({ to: who.email, subject: msgs.subject, html: msgs.html, text: msgs.text }) : { status: 'skipped', detail: 'No email on file.' },
  ]);
  const delivered = sms.status === 'sent' || email.status === 'sent';

  if (delivered) {
    await admin.from('estimates').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', est.id);
  }
  await admin.from('job_events').insert({
    job_id: est.job_id,
    lead_id: est.lead_id,
    actor_id: auth.staff.id,
    actor_email: auth.staff.email,
    kind: 'estimate_delivery',
    details: { delivered, sms: { status: sms.status, detail: sms.detail }, email: { status: email.status, detail: email.detail } },
  });

  return NextResponse.json({
    ok: delivered,
    results: { sms, email },
    link,
    subject: msgs.subject,
    sms_body: msgs.sms,
    text_body: msgs.text,
  });
}
