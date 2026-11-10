import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { siteUrl } from '@/lib/integrations';
import { sendSms, sendEmail } from '@/lib/notify';
import { buildUpdateMessages, isUuid, updateRecipients } from '@/lib/jobDocs';

export const dynamic = 'force-dynamic';

// Sends a progress update to the customer and the job's extra contacts: a text and an email, each with
// a link to the update page. Office and owner only. The update becomes "sent" only when something was
// actually delivered. Body { manual: true } marks it sent without sending (the office shares the link
// themselves), so the link starts working.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  if (!isUuid(params.id) || !isUuid(params.updateId)) return NextResponse.json({ error: 'Update not found.' }, { status: 404 });

  const admin = getAdmin();
  const { data: upd } = await admin
    .from('job_updates')
    .select('id,job_id,kind,status,share_token,sent_at,body,photo_ids')
    .eq('id', params.updateId)
    .eq('job_id', params.id)
    .maybeSingle();
  if (!upd) return NextResponse.json({ error: 'Update not found.' }, { status: 404 });
  if (upd.kind !== 'progress') return NextResponse.json({ error: 'Only progress updates can be sent to a customer.' }, { status: 400 });

  const payload = await request.json().catch(() => ({}));
  const manual = payload?.manual === true;

  const [{ data: job }, { data: links }, { data: settings }] = await Promise.all([
    admin.from('jobs').select('job_number,customer:customers(display_name,phone,email)').eq('id', upd.job_id).maybeSingle(),
    admin.from('job_contacts').select('contact:contacts(name,phone,email)').eq('job_id', upd.job_id),
    admin.from('settings').select('business_name').eq('id', 1).maybeSingle(),
  ]);
  if (!job?.customer) return NextResponse.json({ error: 'Could not find the customer for this job.' }, { status: 404 });

  const link = `${siteUrl(request)}/u/${upd.share_token}`;
  const now = new Date().toISOString();
  const actor = { actor_id: auth.staff.id, actor_email: auth.staff.email };

  if (manual) {
    await admin.from('job_updates').update({
      status: 'sent', sent_at: upd.sent_at || now, sent_by: auth.staff.id, delivery: { manual: true, at: now },
    }).eq('id', upd.id);
    await admin.from('job_events').insert({ job_id: upd.job_id, ...actor, kind: 'progress_update_sent', details: { update_id: upd.id, manual: true } });
    return NextResponse.json({ ok: true, manual: true, link, results: [] });
  }

  const recipients = updateRecipients(
    { name: job.customer.display_name, phone: job.customer.phone, email: job.customer.email },
    (links || []).map((l) => l.contact).filter(Boolean),
  );
  if (!recipients.length) {
    return NextResponse.json({ error: 'No customer or contact has a mobile number or email on file.' }, { status: 400 });
  }

  const results = [];
  for (const r of recipients) {
    const msgs = buildUpdateMessages({ business: settings?.business_name, customerName: r.name, link, jobNumber: job.job_number });
    const [sms, email] = await Promise.all([
      r.phone ? sendSms({ to: r.phone, body: msgs.sms }) : { status: 'skipped', detail: 'No mobile number.' },
      r.email ? sendEmail({ to: r.email, subject: msgs.subject, html: msgs.html, text: msgs.text }) : { status: 'skipped', detail: 'No email.' },
    ]);
    results.push({ name: r.name, sms: { status: sms.status, detail: sms.detail }, email: { status: email.status, detail: email.detail } });
  }
  const delivered = results.some((r) => r.sms.status === 'sent' || r.email.status === 'sent');

  if (delivered) {
    await admin.from('job_updates').update({
      status: 'sent', sent_at: upd.sent_at || now, sent_by: auth.staff.id, delivery: { manual: false, at: now, results },
    }).eq('id', upd.id);
  }
  await admin.from('job_events').insert({
    job_id: upd.job_id, ...actor, kind: delivered ? 'progress_update_sent' : 'progress_update_send_failed',
    details: { update_id: upd.id, manual: false, delivered, results },
  });

  return NextResponse.json({ ok: delivered, results, link });
}
