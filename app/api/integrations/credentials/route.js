import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { writeAudit } from '@/lib/supabaseAdmin';
import { PROVIDERS, getStatuses, saveCredentials, removeCredentials, siteUrl } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

// Owner only. Returns status + webhook URLs. Never returns secret values.
export async function GET(request) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  try {
    const statuses = await getStatuses();
    const base = siteUrl(request);
    for (const [p, def] of Object.entries(PROVIDERS)) {
      statuses[p].webhookUrl = base + def.webhookPath;
    }
    return NextResponse.json({ integrations: statuses });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Body: { provider, values: { field: value } }. Blank fields keep the stored value.
export async function PUT(request) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  try {
    const { provider, values } = await request.json();
    if (!PROVIDERS[provider]) return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
    await saveCredentials(provider, values || {}, auth.user.id);
    await writeAudit({
      actor: { id: auth.user.id, email: auth.staff.email },
      action: 'integration.saved',
      entity: 'integration',
      entityId: provider,
      details: { fields_submitted: Object.keys(values || {}).filter((k) => (values[k] ?? '').toString().trim()) },
    });
    const statuses = await getStatuses();
    return NextResponse.json({ ok: true, status: statuses[provider] });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(request) {
  const auth = await requireStaff(request, ['owner']);
  if (auth.error) return auth.error;
  const provider = new URL(request.url).searchParams.get('provider');
  if (!PROVIDERS[provider]) return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
  try {
    await removeCredentials(provider);
    await writeAudit({
      actor: { id: auth.user.id, email: auth.staff.email },
      action: 'integration.removed',
      entity: 'integration',
      entityId: provider,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
