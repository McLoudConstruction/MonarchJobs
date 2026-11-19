import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { monthlyScanCount, connectedProviders } from '@/lib/aiServer';

export const dynamic = 'force-dynamic';

// Whether scanning is set up (for showing the Scan button) and how many scans this month. Owner and office.
export async function GET(request) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  const { order } = await connectedProviders();
  return NextResponse.json({ ready: order.length > 0, providers: order, scansThisMonth: await monthlyScanCount() });
}
