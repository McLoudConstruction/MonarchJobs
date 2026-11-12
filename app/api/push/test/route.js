import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { sendTestPush } from '@/lib/pushServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// "Send me a test notification": pushes to the signed-in person's own phones only.
export async function POST(request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  const result = await sendTestPush(auth.staff.id);
  if (!result.sent) {
    return NextResponse.json({ error: result.reason || 'The test could not be delivered. Try turning notifications off and on again on this device.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, sent: result.sent });
}
