import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { siteUrl } from '@/lib/integrations';
import { findSlot } from '@/lib/booking';
import { loadSchedulable, loadOpenSlots, bookSlot, sendBookingConfirmation } from '@/lib/bookingServer';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The customer picks a time after approving and signing. The slot is checked against what is open right now, then
// booked under a database lock, so two customers cannot take the same one. The work order, visit and history are
// created the same way the office does it, with the tech left unassigned for the office to fill in.
export async function POST(request, { params }) {
  if (!UUID.test(params.token)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const startMs = new Date(String(body.start || '')).getTime();
  if (!Number.isFinite(startMs)) return NextResponse.json({ error: 'Please pick a time.' }, { status: 400 });

  const admin = getAdmin();
  const found = await loadSchedulable(admin, params.token);
  if (found.error) return NextResponse.json({ error: found.error }, { status: found.status });
  const { lead, settings } = found;

  const open = await loadOpenSlots(admin, settings);
  const chosen = findSlot(open.days, new Date(startMs).toISOString());
  if (!chosen) return NextResponse.json({ error: 'That time is no longer open. Please pick another.', code: 'SLOT_TAKEN' }, { status: 409 });

  await admin.from('job_events').insert({
    lead_id: lead.id, kind: 'self_scheduled', details: { start: chosen.start, end: chosen.end },
  });
  const booked = await bookSlot(admin, lead.id, chosen.start);
  if (booked.error) return NextResponse.json({ error: booked.error, code: booked.code }, { status: booked.status });

  await sendBookingConfirmation({
    admin, jobId: booked.jobId, settings, lead, startIso: chosen.start, endIso: chosen.end, link: `${siteUrl(request)}/e/${params.token}`,
  });
  return NextResponse.json({ ok: true, start: chosen.start, end: chosen.end, tz: open.tz });
}
