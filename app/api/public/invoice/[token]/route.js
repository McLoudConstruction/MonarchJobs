import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { PHOTO_BUCKET } from '@/lib/jobDocs';
import { onlineProviders, UUID } from '@/lib/invoiceServer';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

// The customer's invoice, found by its secret link. Drafts are not visible. Staff names, notes and the other
// invoices on the job are never returned. A view is recorded unless ?preview=1.
export async function GET(request, { params }) {
  if (!UUID.test(params.token)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const admin = getAdmin();
  const { data: inv } = await admin.from('invoices').select('*').eq('share_token', params.token).maybeSingle();
  if (!inv || inv.status === 'draft') return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const preview = new URL(request.url).searchParams.get('preview') === '1';
  if (!preview && inv.status !== 'void') {
    const now = new Date().toISOString();
    await admin.from('invoices').update({ first_viewed_at: inv.first_viewed_at ?? now, last_viewed_at: now, view_count: (inv.view_count || 0) + 1 }).eq('id', inv.id);
  }

  const [{ data: lines }, { data: interest }, { data: payments }, { data: photoRows }, { data: job }, { data: settings }, providers] = await Promise.all([
    admin.from('invoice_lines').select('id,description,unit,quantity,unit_price,sort_order').eq('invoice_id', inv.id).order('sort_order'),
    admin.from('invoice_interest').select('id,rate_percent,months,amount_cents,applied_at').eq('invoice_id', inv.id).is('waived_at', null).order('applied_at'),
    admin.from('payments').select('method,amount_cents,tip_cents,received_at').eq('invoice_id', inv.id).order('received_at'),
    admin.from('invoice_photos').select('photo_id,sort_order').eq('invoice_id', inv.id).order('sort_order'),
    admin.from('jobs').select('job_number,job_type,address:addresses(street,unit,city,state,zip)').eq('id', inv.job_id).maybeSingle(),
    admin.from('settings').select('business_name,phone,email,logo_path,invoice_footer').eq('id', 1).maybeSingle(),
    onlineProviders(),
  ]);

  const ids = (photoRows || []).map((r) => r.photo_id);
  let photos = [];
  if (ids.length) {
    const { data: rows } = await admin.from('job_photos').select('id,caption,kind,storage_path,thumb_path,archived_at').in('id', ids);
    const byId = new Map((rows || []).filter((p) => !p.archived_at).map((p) => [p.id, p]));
    const ordered = ids.map((i) => byId.get(i)).filter(Boolean);
    const paths = ordered.flatMap((p) => [p.storage_path, p.thumb_path]).filter(Boolean);
    const signed = new Map();
    if (paths.length) {
      const { data } = await admin.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
      for (const d of data || []) if (d.signedUrl && !d.error) signed.set(d.path, d.signedUrl);
    }
    photos = ordered.map((p) => ({ id: p.id, kind: p.kind, caption: p.caption, url: signed.get(p.storage_path) || null, thumb_url: signed.get(p.thumb_path) || signed.get(p.storage_path) || null })).filter((p) => p.url);
  }

  const open = (inv.status === 'sent' || inv.status === 'partial') && inv.balance_cents > 0;
  return NextResponse.json({
    invoice: {
      number: inv.invoice_number, kind: inv.kind, status: inv.status, bill_to_name: inv.bill_to_name, po_number: inv.po_number, scope_note: inv.scope_note,
      minimum_charge: inv.minimum_charge, minimum_adjustment_cents: inv.minimum_adjustment_cents, subtotal_cents: inv.subtotal_cents, total_cents: inv.total_cents,
      credit_cents: inv.credit_cents, interest_cents: inv.interest_cents, paid_cents: inv.paid_cents, balance_cents: inv.balance_cents,
      issued_at: inv.issued_at, due_date: inv.due_date, paid_at: inv.paid_at,
    },
    lines: lines || [],
    interest: interest || [],
    payments: (payments || []).map((p) => ({ method: p.method, amount_cents: p.amount_cents, tip_cents: p.tip_cents, received_at: p.received_at })),
    photos,
    job: job ? { job_number: job.job_number, job_type: job.job_type, address: job.address } : null,
    business: settings || {},
    can_pay: open && (providers.square || providers.stripe),
    tip_available: open && providers.square,
  }, { headers: NO_STORE });
}
