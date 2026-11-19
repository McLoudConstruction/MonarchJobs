import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { UUID } from '@/lib/invoiceServer';
import { validateLabor, nameKey, totalMinutes } from '@/lib/laborPool';
import { staffName } from '@/lib/userDisplay';

export const dynamic = 'force-dynamic';

const missing = (e) => /does not exist|schema cache|Could not find the table/i.test(e?.message || '');
const NEEDS_MIGRATION = 'The labor pool is not set up yet. Run migration 026, then try again.';

// The labor pool on a job: people who are not on the staff list, with their times, certified by a staff member's signature.
//   { action: 'add', entries: [{ name, started_at, ended_at }], signature }   any staff on the job (office and owner on any job)
//   { action: 'void', entry_id, reason? }                                      office and owner only; the entry stays on the record, removed
// New names are added to the pool (the bucket of repeat helpers) as the form is saved. These people are never matched against staff.
export async function POST(request, { params }) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const admin = getAdmin();
  const office = auth.staff.role !== 'tech';

  const { data: job } = await admin.from('jobs').select('id,status').eq('id', params.id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });

  if (body.action === 'void') {
    if (!office) return NextResponse.json({ error: 'Only the office and owner can remove labor entries.' }, { status: 403 });
    if (!UUID.test(String(body.entry_id || ''))) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 });
    const { data: entry, error: readErr } = await admin.from('job_labor_entries').select('id,job_id,worker_name,started_at,ended_at,voided_at').eq('id', body.entry_id).maybeSingle();
    if (readErr) return NextResponse.json({ error: missing(readErr) ? NEEDS_MIGRATION : readErr.message }, { status: 500 });
    if (!entry || entry.job_id !== job.id) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 });
    if (entry.voided_at) return NextResponse.json({ error: 'That entry was already removed.' }, { status: 409 });
    const { error } = await admin.from('job_labor_entries').update({ voided_at: new Date().toISOString(), void_reason: String(body.reason || '').trim().slice(0, 300), voided_by: auth.staff.id }).eq('id', entry.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from('job_events').insert({ job_id: job.id, actor_id: auth.staff.id, actor_email: auth.staff.email, kind: 'labor_pool_removed', details: { name: entry.worker_name } });
    return NextResponse.json({ ok: true });
  }

  if (body.action !== 'add') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  if (['closed', 'cancelled'].includes(job.status)) return NextResponse.json({ error: `This job is ${job.status}.` }, { status: 409 });
  if (!office) {
    const { data: mine } = await admin.from('job_visits').select('id').eq('job_id', job.id).eq('tech_id', auth.staff.id).limit(1);
    if (!mine?.length) return NextResponse.json({ error: 'You are not on this job.' }, { status: 403 });
  }

  const { data: existing, error: exErr } = await admin.from('job_labor_entries').select('worker_name,started_at,ended_at,voided_at').eq('job_id', job.id).is('voided_at', null);
  if (exErr) return NextResponse.json({ error: missing(exErr) ? NEEDS_MIGRATION : exErr.message }, { status: 500 });
  const checked = validateLabor({ entries: body.entries, signature: body.signature, existing: existing || [] });
  if (checked.error) return NextResponse.json({ error: checked.error }, { status: 400 });

  // the pool: reuse a name that is already there (bringing a retired one back), add the ones that are new
  const { data: pool, error: poolErr } = await admin.from('labor_pool_people').select('id,name,active');
  if (poolErr) return NextResponse.json({ error: missing(poolErr) ? NEEDS_MIGRATION : poolErr.message }, { status: 500 });
  const byKey = new Map((pool || []).map((p) => [nameKey(p.name), p]));
  for (const e of checked.value) {
    const found = byKey.get(e.key);
    if (found) {
      if (!found.active) { await admin.from('labor_pool_people').update({ active: true }).eq('id', found.id); found.active = true; }
      continue;
    }
    const { data: made, error } = await admin.from('labor_pool_people').insert({ name: e.name, created_by: auth.staff.id }).select('id,name,active').maybeSingle();
    if (made) { byKey.set(e.key, made); continue; }
    // someone saved the same name a moment ago: use theirs
    const { data: again } = await admin.from('labor_pool_people').select('id,name,active').ilike('name', e.name.replace(/[\\%_]/g, '\\$&')).limit(1).maybeSingle();
    if (!again) return NextResponse.json({ error: error?.message || 'Could not save the name.' }, { status: 500 });
    byKey.set(e.key, again);
  }

  const { data: cert, error: certErr } = await admin.from('job_labor_certifications')
    .insert({ job_id: job.id, certified_by: auth.staff.id, certifier_name: staffName(auth.staff).slice(0, 120), signature_png: body.signature })
    .select('id,certified_at').maybeSingle();
  if (certErr || !cert) return NextResponse.json({ error: certErr?.message || 'Could not save the form.' }, { status: 500 });
  const rows = checked.value.map((e) => ({
    certification_id: cert.id, job_id: job.id, pool_person_id: byKey.get(e.key)?.id || null, worker_name: e.name, started_at: e.started_at, ended_at: e.ended_at,
  }));
  const { error: entErr } = await admin.from('job_labor_entries').insert(rows);
  if (entErr) {
    await admin.from('job_labor_certifications').delete().eq('id', cert.id); // never leave a signed form with no names
    return NextResponse.json({ error: entErr.message }, { status: 500 });
  }
  await admin.from('job_events').insert({
    job_id: job.id, actor_id: auth.staff.id, actor_email: auth.staff.email, kind: 'labor_pool_added',
    details: { count: rows.length, minutes: totalMinutes(rows) },
  });
  return NextResponse.json({ ok: true, certified_at: cert.certified_at, count: rows.length });
}
