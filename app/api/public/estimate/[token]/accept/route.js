import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { estimateTotals, estimateSnapshot } from '@/lib/estimate';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PNG_PREFIX = 'data:image/png;base64,';
const MAX_SIGNATURE_CHARS = 400000;
const PNG_MAGIC = '89504e470d0a1a0a';

// The customer approves the estimate and signs. The secret link is the access, same as viewing.
// Records exactly what they saw (lines and total), when, and from where, then marks the estimate
// approved. The database moves the lead to "Ready to schedule" when the estimate is approved.
export async function POST(request, { params }) {
  const token = params.token;
  if (!UUID.test(token)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  const signature = String(body.signature || '');
  const preferred = String(body.preferred_times || '').trim().slice(0, 500);

  if (name.length < 2 || name.length > 120) return NextResponse.json({ error: 'Please type your full name.' }, { status: 400 });
  if (!signature.startsWith(PNG_PREFIX) || signature.length > MAX_SIGNATURE_CHARS) {
    return NextResponse.json({ error: 'Please sign in the box.' }, { status: 400 });
  }
  let bytes;
  try {
    bytes = Buffer.from(signature.slice(PNG_PREFIX.length), 'base64');
  } catch {
    return NextResponse.json({ error: 'Please sign in the box.' }, { status: 400 });
  }
  if (bytes.subarray(0, 8).toString('hex') !== PNG_MAGIC) return NextResponse.json({ error: 'Please sign in the box.' }, { status: 400 });

  const admin = getAdmin();
  const { data: est } = await admin
    .from('estimates')
    .select('id,job_id,lead_id,status,minimum_charge')
    .eq('share_token', token)
    .maybeSingle();
  if (!est || est.status === 'draft') return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (est.status === 'approved') return NextResponse.json({ error: 'This estimate was already approved.' }, { status: 409 });
  if (est.status !== 'sent') return NextResponse.json({ error: 'This estimate can no longer be approved online. Please contact us.' }, { status: 409 });

  const { data: lines } = await admin
    .from('estimate_lines')
    .select('description,unit,quantity,unit_price,sort_order,created_at')
    .eq('estimate_id', est.id)
    .order('sort_order')
    .order('created_at');
  if (!lines?.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const totals = estimateTotals(lines, est.minimum_charge);
  const snapshot = estimateSnapshot(lines, est.minimum_charge);

  // Approve first, only if it is still "sent", so two quick taps cannot sign twice.
  const now = new Date().toISOString();
  const { data: approved, error: aerr } = await admin
    .from('estimates')
    .update({ status: 'approved', approved_at: now })
    .eq('id', est.id)
    .eq('status', 'sent')
    .select('id')
    .maybeSingle();
  if (aerr) return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  if (!approved) return NextResponse.json({ error: 'This estimate was already approved.' }, { status: 409 });

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
  const { error: serr } = await admin.from('estimate_signatures').insert({
    estimate_id: est.id,
    signer_name: name,
    signature_png: signature,
    signed_at: now,
    ip,
    user_agent: (request.headers.get('user-agent') || '').slice(0, 300),
    total_cents: totals.totalCents,
    minimum_charge: snapshot.minimum_charge,
    lines_snapshot: snapshot.lines,
    preferred_times: preferred,
  });
  if (serr) {
    // Do not leave an approval with no signature behind it.
    await admin.from('estimates').update({ status: 'sent', approved_at: null }).eq('id', est.id);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }

  if (est.lead_id && preferred) {
    await admin.from('leads').update({ preferred_times: preferred }).eq('id', est.lead_id).in('status', ['new', 'quoted', 'accepted']);
  }
  await admin.from('job_events').insert({
    job_id: est.job_id,
    lead_id: est.lead_id,
    kind: 'estimate_signed',
    details: { signer_name: name, total_cents: totals.totalCents, ip },
  });

  return NextResponse.json({ ok: true });
}
