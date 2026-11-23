import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { optionalStaff } from '@/lib/apiAuth';
import { loadBookingSettings, loadOpenSlots } from '@/lib/bookingServer';
import { loadOffer } from '@/lib/slowDayServer';
import { offerStatus, limitDaysToOffer } from '@/lib/slowDay';

export const dynamic = 'force-dynamic';

// The open appointment times for the booking page. Same rule as the page itself: staff always, everyone else only
// while online booking is on.
export async function GET(request) {
  const who = await optionalStaff(request);
  if (who.error) return who.error;
  const admin = getAdmin();
  const settings = await loadBookingSettings(admin);
  if (!who.staff && settings.booking_enabled === false) return NextResponse.json({ error: 'Online booking is not available right now.' }, { status: 403 });
  const open = await loadOpenSlots(admin, settings);
  // A slow-day offer link shows only the days the offer covers.
  const offerToken = new URL(request.url).searchParams.get('offer');
  if (offerToken && !who.staff) {
    const row = await loadOffer(admin, offerToken);
    if (offerStatus(row, { tz: open.tz }).ok) return NextResponse.json({ ...open, days: limitDaysToOffer(open.days, row.dates) });
  }
  return NextResponse.json(open);
}
