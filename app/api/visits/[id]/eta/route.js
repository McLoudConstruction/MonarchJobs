import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { ensureCoords, trafficDrive } from '@/lib/googleServer';
import { etaFromSeconds } from '@/lib/onTheWay';

export const dynamic = 'force-dynamic';

// The phone asks "how far am I from this job right now?" when the tech opens the On the way popup.
// Body: { lat, lng } (the phone's position, used for this one lookup and never saved).
// Answers { minutes (exact), suggested (rounded up to 5) }, or { unavailable: true } when it cannot tell, so the tech picks the minutes by hand.
export async function POST(request, { params }) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => ({}));
  const lat = Number(body.lat); const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return NextResponse.json({ unavailable: true });

  const admin = getAdmin();
  const { data: visit } = await admin.from('job_visits').select('id,tech_id,job:jobs(address:addresses(id,street,unit,city,state,zip,lat,lng,geocode_status))').eq('id', params.id).maybeSingle();
  if (!visit) return NextResponse.json({ error: 'Visit not found.' }, { status: 404 });
  if (auth.staff.role === 'tech' && visit.tech_id !== auth.staff.id) return NextResponse.json({ error: 'This visit is not assigned to you.' }, { status: 403 });
  const addr = visit.job?.address;
  if (!addr) return NextResponse.json({ unavailable: true });

  const g = await ensureCoords(admin, [addr], 1);
  const dest = g.coords.get(addr.id);
  if (!dest) return NextResponse.json({ unavailable: true });
  const drive = await trafficDrive({ lat, lng }, dest);
  if (drive.error) return NextResponse.json({ unavailable: true });
  const eta = etaFromSeconds(drive.seconds);
  if (!eta) return NextResponse.json({ unavailable: true });
  return NextResponse.json({ minutes: eta.exact, suggested: eta.rounded });
}
