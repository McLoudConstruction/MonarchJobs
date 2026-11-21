import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Stop reminders about this estimate", from the link in the follow-up text or email. Only this estimate's follow-ups stop;
// the estimate itself stays open and can still be approved. The secret link is the access, same as viewing.
export async function POST(request, { params }) {
  if (!UUID.test(params.token)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const admin = getAdmin();
  const { data: est } = await admin.from('estimates').select('id,status').eq('share_token', params.token).maybeSingle();
  if (!est || est.status === 'draft') return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const { error } = await admin.from('estimates').update({ followups_paused: true }).eq('id', est.id);
  if (error) return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
