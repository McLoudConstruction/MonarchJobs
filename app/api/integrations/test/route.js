import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { PROVIDERS, testConnection } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  const { provider } = await request.json().catch(() => ({}));
  if (!PROVIDERS[provider]) return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
  const result = await testConnection(provider);
  return NextResponse.json(result);
}
