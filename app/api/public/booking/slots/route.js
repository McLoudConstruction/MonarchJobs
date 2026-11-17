import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { optionalStaff } from '@/lib/apiAuth';
import { loadBookingSettings, loadOpenSlots } from '@/lib/bookingServer';

export const dynamic = 'force-dynamic';

// The open appointment times for the booking page. Same rule as the page itself: staff always, everyone else only
// while online booking is on.
export async function GET(request) {
  const who = await optionalStaff(request);
  if (who.error) return who.error;
  const admin = getAdmin();
  const settings = await loadBookingSettings(admin);
  if (!who.staff && settings.booking_enabled === false) return NextResponse.json({ error: 'Online booking is not available right now.' }, { status: 403 });
  return NextResponse.json(await loadOpenSlots(admin, settings));
}
