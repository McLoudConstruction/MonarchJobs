// Sends the aftercare text and email for a finished job. Server only.
// Safe to call after a job completes: it never throws, and sends nothing when there is nothing to say.
import { sendSms, sendEmail } from './notify.js';
import { aftercareFor, buildAftercareMessages } from './aftercare.js';
import { effectiveLines, choiceFromEstimate } from './estimateOptions.js';
import { latestSigned } from './inspection.js';

// Gathers what the customer should be told for a job.
export async function loadAftercare(admin, jobId) {
  const { data: job } = await admin
    .from('jobs')
    .select('id,customer_token,customer:customers(display_name,phone,email,marketing_opt_out)')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) return null;
  const [{ data: settings }, { data: est }, { data: inspections }] = await Promise.all([
    admin.from('settings').select('business_name,aftercare_default').eq('id', 1).maybeSingle(),
    admin.from('estimates').select('id,status,chosen_tier').eq('job_id', jobId).maybeSingle(),
    admin.from('job_inspections').select('kind,data,signed_at').eq('job_id', jobId).not('signed_at', 'is', null),
  ]);
  let lines = [];
  if (est) {
    const { data: l } = await admin.from('estimate_lines').select('id,price_item_id,tier,optional,accepted').eq('estimate_id', est.id);
    lines = effectiveLines(l || [], est.status === 'approved' ? choiceFromEstimate(est, l || []) : { tier: null, picks: [] });
  }
  const ids = [...new Set(lines.map((l) => l.price_item_id).filter(Boolean))];
  const items = {};
  if (ids.length) {
    const { data: p } = await admin.from('price_items').select('id,name,aftercare,dry_hours').in('id', ids);
    for (const it of p || []) items[it.id] = it;
  }
  const post = latestSigned((inspections || []).map((i) => ({ ...i })), 'post');
  const content = aftercareFor({ lines, items, defaultText: settings?.aftercare_default, postDryHours: post?.data?.drying_hours });
  return { job, settings: settings || {}, content };
}

// force: the office tapped "send now", so send even when it was sent before or there is no text.
export async function sendAftercare({ admin, jobId, origin, force = false, actor = null }) {
  try {
    const info = await loadAftercare(admin, jobId);
    if (!info) return { sent: false, reason: 'Job not found.' };
    const { job, settings, content } = info;
    if (!force && !content.hasContent) return { sent: false, reason: 'No aftercare text or drying time set up.' };
    if (!force) {
      const { count } = await admin.from('job_events').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('kind', 'aftercare_sent');
      if (count) return { sent: false, reason: 'Already sent.' };
    }
    const who = job.customer || {};
    const link = `${origin}/c/${job.customer_token}`;
    const msgs = buildAftercareMessages({ business: settings.business_name, customerName: who.display_name, link, notes: content.notes, dryHours: content.dryHours });
    const [sms, email] = await Promise.all([
      who.phone ? sendSms({ to: who.phone, body: msgs.sms }) : { status: 'skipped', detail: 'No phone number on file.' },
      who.email ? sendEmail({ to: who.email, subject: msgs.subject, html: msgs.html, text: msgs.text }) : { status: 'skipped', detail: 'No email on file.' },
    ]);
    const delivered = sms.status === 'sent' || email.status === 'sent';
    if (delivered || force) {
      await admin.from('job_events').insert({
        job_id: jobId,
        actor_id: actor?.id || null,
        actor_email: actor?.email || null,
        kind: 'aftercare_sent',
        details: { delivered, manual: !!force, sms: { status: sms.status, detail: sms.detail }, email: { status: email.status, detail: email.detail } },
      });
    }
    return { sent: delivered, results: { sms, email }, link, sms_body: msgs.sms, subject: msgs.subject, text_body: msgs.text };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}
