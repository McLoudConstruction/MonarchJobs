import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { isUuid } from '@/lib/jobDocs';
import { signText } from '@/lib/signText';
import { addressLine } from '@/lib/format';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };
const PNG_PREFIX = 'data:image/png;base64,';
const MAX_SIGNATURE_CHARS = 400000;
const PNG_MAGIC = '89504e470d0a1a0a';

async function load(admin, token) {
  const { data: reqRow } = await admin.from('job_sign_requests').select('*').eq('token', token).maybeSingle();
  if (!reqRow) return null;
  const [{ data: job }, { data: settings }] = await Promise.all([
    admin.from('jobs').select('id,status,customer:customers(display_name),address:addresses(street,unit,city,state,zip)').eq('id', reqRow.job_id).maybeSingle(),
    admin.from('settings').select('business_name,phone,email,logo_path').eq('id', 1).maybeSingle(),
  ]);
  return { reqRow, job, settings };
}

// The customer opens the secret link: what they are signing, for which job, and whether it is already signed.
export async function GET(request, { params }) {
  if (!isUuid(params.token)) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });
  const found = await load(getAdmin(), params.token);
  if (!found?.job) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });
  const { reqRow, job, settings } = found;
  const business = settings?.business_name || 'the company';
  const address = addressLine(job.address) || 'the property';
  return NextResponse.json({
    kind: reqRow.kind,
    signed: !!reqRow.signed_at,
    closed: ['closed', 'cancelled'].includes(job.status),
    customer: job.customer?.display_name || '',
    address,
    text: signText(reqRow.kind, { business, address, customer: job.customer?.display_name || '' }),
    business: { business_name: settings?.business_name || '', phone: settings?.phone || '', email: settings?.email || '', logo_path: settings?.logo_path || null },
  }, { headers: NO_STORE });
}

// The customer signs. Records the name and signature as the same kind of step a tech records on site (via the link).
export async function POST(request, { params }) {
  if (!isUuid(params.token)) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  const signature = String(body.signature || '');
  if (name.length < 2 || name.length > 120) return NextResponse.json({ error: 'Please type your full name.' }, { status: 400 });
  if (!signature.startsWith(PNG_PREFIX) || signature.length > MAX_SIGNATURE_CHARS) return NextResponse.json({ error: 'Please sign in the box.' }, { status: 400 });
  let bytes;
  try { bytes = Buffer.from(signature.slice(PNG_PREFIX.length), 'base64'); } catch { return NextResponse.json({ error: 'Please sign in the box.' }, { status: 400 }); }
  if (bytes.subarray(0, 8).toString('hex') !== PNG_MAGIC) return NextResponse.json({ error: 'Please sign in the box.' }, { status: 400 });

  const admin = getAdmin();
  const found = await load(admin, params.token);
  if (!found?.job) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const { reqRow, job } = found;
  if (reqRow.signed_at) return NextResponse.json({ error: 'This was already signed. Thank you.' }, { status: 409 });
  if (['closed', 'cancelled'].includes(job.status)) return NextResponse.json({ error: 'This job is closed. Please contact us.' }, { status: 409 });

  // claim the request first so two quick taps cannot sign twice
  const now = new Date().toISOString();
  const { data: claimed } = await admin.from('job_sign_requests').update({ signed_at: now }).eq('id', reqRow.id).is('signed_at', null).select('id').maybeSingle();
  if (!claimed) return NextResponse.json({ error: 'This was already signed. Thank you.' }, { status: 409 });
  const { data: step, error } = await admin.from('job_water_steps')
    .insert({ job_id: job.id, kind: reqRow.kind, signer_name: name, signature_png: signature, data: { via: 'link' } })
    .select('id').maybeSingle();
  if (error) {
    await admin.from('job_sign_requests').update({ signed_at: null }).eq('id', reqRow.id);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
  await admin.from('job_sign_requests').update({ step_id: step?.id || null }).eq('id', reqRow.id);
  await admin.from('job_events').insert({
    job_id: job.id, kind: reqRow.kind === 'certificate' ? 'water_certificate_signed' : 'water_authorization_signed',
    details: { signer_name: name, via: 'link' },
  });
  return NextResponse.json({ ok: true });
}
