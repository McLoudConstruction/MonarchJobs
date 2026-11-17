import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { isUuid } from '@/lib/jobDocs';
import { normalizePlan } from '@/lib/sketch';
import { adjusterView } from '@/lib/adjusterView';
import { withJobStandards } from '@/lib/moisture';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// A job's drying, found by its secret adjuster link: read only, and only while the link is neither revoked nor expired.
// Staff names, notes and photos are never returned. A view is recorded unless ?preview=1.
export async function GET(request, { params }) {
  const token = params.token;
  if (!isUuid(token)) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });

  const admin = getAdmin();
  const { data: link } = await admin
    .from('adjuster_links')
    .select('id,job_id,expires_at,revoked_at,first_viewed_at,view_count')
    .eq('token', token)
    .maybeSingle();
  if (!link || link.revoked_at || Date.parse(link.expires_at) < Date.now()) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });

  if (new URL(request.url).searchParams.get('preview') !== '1') {
    const now = new Date().toISOString();
    await admin.from('adjuster_links').update({ first_viewed_at: link.first_viewed_at ?? now, last_viewed_at: now, view_count: (link.view_count || 0) + 1 }).eq('id', link.id);
  }

  const [{ data: job }, { data: settings }, { data: sketches }] = await Promise.all([
    admin.from('jobs').select('job_number,job_type,dry_standards,customer:customers(display_name),address:addresses(street,unit,city,state,zip)').eq('id', link.job_id).maybeSingle(),
    admin.from('settings').select('business_name,phone,email,logo_path').eq('id', 1).maybeSingle(),
    admin.from('job_sketches').select('name,plan').eq('job_id', link.job_id).order('sort_order').order('created_at'),
  ]);

  const views = (sketches || [])
    .map((s) => adjusterView(withJobStandards(normalizePlan(s.plan), job?.dry_standards), s.name))
    .filter((v) => v.hasData || v.equipment);

  return NextResponse.json({
    business: settings || {},
    job: job ? { job_number: job.job_number, job_type: job.job_type, customer: job.customer?.display_name || '', address: job.address } : null,
    expires_at: link.expires_at,
    sketches: views,
  }, { headers: NO_STORE });
}
