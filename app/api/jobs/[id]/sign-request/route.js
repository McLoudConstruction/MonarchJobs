import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { siteUrl } from '@/lib/integrations';
import { sendSms, sendEmail } from '@/lib/notify';
import { signKindOk, SIGN_KINDS } from '@/lib/signText';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Makes an e-sign link for the work authorization or the certificate of completion and texts and emails it to the customer.
// A provider that is not set up is skipped, and the link comes back either way so the office can copy it.
// Body: { kind: 'authorization' | 'certificate' }
export async function POST(request, { params }) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (!signKindOk(body.kind)) return NextResponse.json({ error: 'Unknown document.' }, { status: 400 });
  const admin = getAdmin();
  const { data: job } = await admin.from('jobs').select('id,status,customer:customers(display_name,phone,email)').eq('id', params.id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  if (['closed', 'cancelled'].includes(job.status)) return NextResponse.json({ error: `This job is ${job.status}.` }, { status: 409 });
  if (auth.staff.role === 'tech') {
    const { count } = await admin.from('job_visits').select('id', { count: 'exact', head: true }).eq('job_id', job.id).eq('tech_id', auth.staff.id);
    if (!count) return NextResponse.json({ error: 'This job is not assigned to you.' }, { status: 403 });
  }
  const { data: st } = await admin.from('settings').select('business_name').eq('id', 1).maybeSingle();
  const { data: row, error } = await admin.from('job_sign_requests').insert({ job_id: job.id, kind: body.kind, created_by: auth.staff.id }).select('id,token').maybeSingle();
  if (error || !row) return NextResponse.json({ error: error?.message || 'Could not make the link.' }, { status: 500 });
  const link = `${siteUrl(request)}/sign/${row.token}`;
  const who = job.customer || {};
  const business = st?.business_name || 'Your restoration team';
  const title = SIGN_KINDS[body.kind].title.toLowerCase();
  const text = `${business}: please review and sign your ${title} here: ${link}`;
  const [sms, email] = await Promise.all([
    who.phone ? sendSms({ to: who.phone, body: text }) : { status: 'skipped', detail: 'No phone number on file.' },
    who.email ? sendEmail({ to: who.email, subject: `Please sign your ${title}`, html: `<p>${business}</p><p>Please review and sign your ${title}:</p><p><a href="${link}">${link}</a></p>`, text }) : { status: 'skipped', detail: 'No email on file.' },
  ]);
  const sentTo = [sms.status === 'sent' ? 'text' : '', email.status === 'sent' ? 'email' : ''].filter(Boolean).join(' and ');
  await admin.from('job_sign_requests').update({ sent_to: sentTo }).eq('id', row.id);
  await admin.from('job_events').insert({ job_id: job.id, actor_id: auth.staff.id, actor_email: auth.staff.email, kind: 'sign_link_sent', details: { doc: body.kind, sent: sentTo || 'not sent' } });
  return NextResponse.json({ ok: true, link, sms: { status: sms.status, detail: sms.detail }, email: { status: email.status, detail: email.detail } });
}
