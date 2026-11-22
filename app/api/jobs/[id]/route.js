import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID } from '@/lib/invoiceServer';
import { PHOTO_BUCKET } from '@/lib/jobDocs';

export const dynamic = 'force-dynamic';

// Deletes a job and everything on it (visits, sketch, readings, photos, notes). Owner only, and the request must carry the job number
// as a typed confirmation. A job with a sent or paid invoice, or any payment, is kept: void and settle that invoice first.
// Draft and void invoices with no payments go with the job. Equipment on the job goes back to available.
export async function DELETE(request, { params }) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  const admin = getAdmin();
  const body = await request.json().catch(() => ({}));

  const { data: job } = await admin.from('jobs').select('id, job_number').eq('id', params.id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  if (String(body.confirm ?? '').trim() !== String(job.job_number)) return NextResponse.json({ error: 'Type the job number to confirm.' }, { status: 400 });

  const { data: invoices, error: invErr } = await admin.from('invoices').select('id, status, paid_cents').eq('job_id', job.id);
  if (invErr) return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
  const ids = (invoices || []).map((i) => i.id);
  if ((invoices || []).some((i) => ['sent', 'partial', 'paid'].includes(i.status) || Number(i.paid_cents) > 0)) {
    return NextResponse.json({ error: 'This job has an invoice that was sent or paid, so it cannot be deleted. Void and settle the invoice first.' }, { status: 409 });
  }
  if (ids.length) {
    const { count } = await admin.from('payments').select('id', { count: 'exact', head: true }).in('invoice_id', ids);
    if (count > 0) return NextResponse.json({ error: 'This job has payments recorded on it, so it cannot be deleted.' }, { status: 409 });
  }

  const { data: photos } = await admin.from('job_photos').select('storage_path, thumb_path, original_path').eq('job_id', job.id);

  // machines on this job are free again (the link would otherwise just be cleared and leave them "on a job")
  await admin.from('equipment_assets').update({ status: 'available', job_id: null, unit_id: null }).eq('job_id', job.id).eq('status', 'on_job');

  if (ids.length) {
    const { error } = await admin.from('invoices').delete().in('id', ids);
    if (error) { console.error('delete job: invoices', error.message); return NextResponse.json({ error: 'Could not delete the job. Try again.' }, { status: 500 }); }
  }
  const { error } = await admin.from('jobs').delete().eq('id', job.id);
  if (error) { console.error('delete job', error.message); return NextResponse.json({ error: 'Could not delete the job. Try again.' }, { status: 500 }); }

  const files = (photos || []).flatMap((p) => [p.storage_path, p.thumb_path, p.original_path]).filter(Boolean);
  if (files.length) {
    const { error: rmErr } = await admin.storage.from(PHOTO_BUCKET).remove(files);
    if (rmErr) console.error('delete job: photo files', rmErr.message); // the job is gone; leftover files can be cleaned later
  }
  return NextResponse.json({ ok: true });
}
