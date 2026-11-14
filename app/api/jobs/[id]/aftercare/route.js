import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { siteUrl } from '@/lib/integrations';
import { sendAftercare } from '@/lib/aftercareServer';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Send aftercare now": the office sends the care instructions and the customer page link, even if they were sent before.
export async function POST(request, { params }) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  const result = await sendAftercare({ admin: getAdmin(), jobId: params.id, origin: siteUrl(request), force: true, actor: auth.staff });
  if (result.reason && !result.results) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json({ ok: result.sent, results: result.results, link: result.link, sms_body: result.sms_body, subject: result.subject, text_body: result.text_body });
}
