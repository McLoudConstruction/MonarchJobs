import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/supabaseAdmin';
import { optionalStaff } from '@/lib/apiAuth';
import { siteUrl } from '@/lib/integrations';
import { estimateSnapshot } from '@/lib/estimate';
import { priceBooking } from '@/lib/bookingPrice';
import { cleanBookingBody, leadFieldsFor } from '@/lib/bookingInput';
import { findSlot, localDateStr, normalizeBooking } from '@/lib/booking';
import { estimateTotals } from '@/lib/estimate';
import { offerStatus, slowDayDiscountLine, OFFER_PROBLEMS } from '@/lib/slowDay';
import { loadOffer, claimOffer, releaseOffer } from '@/lib/slowDayServer';
import { loadBookingSettings, loadOpenSlots, bookSlot, sendBookingConfirmation } from '@/lib/bookingServer';

export const dynamic = 'force-dynamic';

const ITEM_COLUMNS = 'id,name,description,unit,price,is_addon,sort_order';
const MAX_PER_PHONE_PER_DAY = 3;
const MAX_PER_HOUR = 25;

// The booking page's starting data: the services it can offer, the minimum and the business details.
// Signed-in staff (a valid login token) get every active price-list item; everyone else gets only the items the owner
// ticked "show on the online booking page" for, and only while online booking is on.
export async function GET(request) {
  const who = await optionalStaff(request);
  if (who.error) return who.error;
  const staff = who.staff;
  const admin = getAdmin();
  const settings = await loadBookingSettings(admin);
  const business = { name: settings.business_name || '', phone: settings.phone || '', email: settings.email || '', logo_path: settings.logo_path || null };
  if (!staff && settings.booking_enabled === false) return NextResponse.json({ enabled: false, business });

  // A slow-day offer link (?offer=...): what it is worth and which days it covers. Never says whose it is.
  let offer = null;
  const offerToken = new URL(request.url).searchParams.get('offer');
  if (offerToken && !staff) {
    const row = await loadOffer(admin, offerToken);
    const st = offerStatus(row, { tz: settings.timezone || 'America/Chicago' });
    offer = st.ok ? { percent: row.percent, dates: row.dates } : { invalid: true, message: OFFER_PROBLEMS[st.reason] || OFFER_PROBLEMS.not_found };
  }

  let query = admin.from('price_items').select(ITEM_COLUMNS).eq('active', true).order('sort_order').order('name');
  if (!staff) query = query.eq('bookable_online', true);
  const { data: services } = await query;
  return NextResponse.json({
    enabled: true,
    staff: staff ? { name: staff.full_name || staff.email } : null,
    business,
    minimum: Number(settings.job_minimum || 0),
    timezone: settings.timezone || 'America/Chicago',
    services: services || [],
    offer,
  });
}

// Books a job. In one go: the lead, the estimate (priced from the price list, job minimum applied), the customer's
// approval and signature, and the appointment. If the chosen time is taken at the last moment the approval is kept and
// the customer picks another time on their estimate page.
export async function POST(request) {
  const who = await optionalStaff(request);
  if (who.error) return who.error;
  const staff = who.staff;
  const admin = getAdmin();
  const settings = await loadBookingSettings(admin);
  if (!staff && settings.booking_enabled === false) {
    return NextResponse.json({ error: 'Online booking is not available right now. Please call us.' }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const cleaned = cleanBookingBody(raw, { staff: !!staff });
  if (cleaned.error) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  const b = cleaned.value;

  // A robot filled in the hidden field: look like it worked, save nothing.
  if (!staff && b.honeypot) return NextResponse.json({ ok: true, scheduled: false });

  // A slow-day offer: good once, for its days only, and only with a time picked.
  const tzName = normalizeBooking(settings).tz;
  let offerRow = null;
  if (!staff && raw.offer) {
    offerRow = await loadOffer(admin, raw.offer);
    const st = offerStatus(offerRow, { tz: tzName });
    if (!st.ok) return NextResponse.json({ error: OFFER_PROBLEMS[st.reason] || OFFER_PROBLEMS.not_found, code: 'OFFER_INVALID' }, { status: 400 });
    if (!b.slot) return NextResponse.json({ error: 'Pick one of the offer days to use this offer.' }, { status: 400 });
  }

  // Price it from the price list. The page's own prices are never trusted.
  const ids = [...new Set(b.items.map((i) => i.id))];
  let itemQuery = admin.from('price_items').select(ITEM_COLUMNS).eq('active', true).in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  if (!staff) itemQuery = itemQuery.eq('bookable_online', true);
  const { data: items } = await itemQuery;
  const priced = priceBooking(items || [], b.items, settings.job_minimum);
  if (priced.error) return NextResponse.json({ error: priced.error }, { status: 400 });
  // The offer's discount is a line on the estimate, never more than takes the total down to the job minimum.
  const discountLine = offerRow
    ? slowDayDiscountLine({ totalCents: priced.totals.totalCents, minimumCents: Math.round(priced.minimum * 100), percent: offerRow.percent, sortOrder: priced.lines.length })
    : null;
  const finalLines = discountLine ? [...priced.lines, discountLine] : priced.lines;
  const finalTotals = discountLine ? estimateTotals(finalLines, priced.minimum) : priced.totals;

  // The time must still be open.
  const now = new Date();
  let chosen = null;
  if (b.slot) {
    const open = await loadOpenSlots(admin, settings, now);
    chosen = findSlot(open.days, b.slot);
    if (!chosen) {
      return NextResponse.json({ error: 'That time is no longer open. Please pick another.', code: 'SLOT_TAKEN' }, { status: 409 });
    }
    if (offerRow && !offerRow.dates.map(String).includes(localDateStr(Date.parse(chosen.start), tzName))) {
      return NextResponse.json({ error: 'This offer is good for the days shown. Please pick one of those days.', code: 'OFFER_DAY' }, { status: 400 });
    }
  }

  // Keep the public page from being used to flood the schedule.
  if (!staff) {
    const sinceDay = new Date(now.getTime() - 86400000).toISOString();
    const sinceHour = new Date(now.getTime() - 3600000).toISOString();
    const online = { booking: 'online' };
    const [byPhone, lastHour] = await Promise.all([
      admin.from('leads').select('id', { count: 'exact', head: true }).contains('intake', online).eq('phone', b.phone).gte('created_at', sinceDay),
      admin.from('leads').select('id', { count: 'exact', head: true }).contains('intake', online).gte('created_at', sinceHour),
    ]);
    if ((byPhone.count || 0) >= MAX_PER_PHONE_PER_DAY || (lastHour.count || 0) >= MAX_PER_HOUR) {
      return NextResponse.json({ error: 'We have received a lot of bookings from this number or network. Please call us to book.' }, { status: 429 });
    }
  }

  // Claim the offer now so one link cannot book twice; it is released again if anything below fails.
  if (offerRow && !(await claimOffer(admin, offerRow.id))) {
    return NextResponse.json({ error: OFFER_PROBLEMS.used, code: 'OFFER_INVALID' }, { status: 409 });
  }

  // An existing customer with this phone or email (and only one of them) keeps one history.
  let customerId = null;
  const { data: matches } = await admin.rpc('find_customer_matches', { p_phone: b.phone, p_email: b.email });
  if ((matches || []).length === 1) customerId = matches[0].id;

  const services = priced.lines.map((l) => l.description);
  const prefix = staff ? 'Booked in person.' : `Booked online by the customer.${offerRow ? ` Slow-day offer, ${offerRow.percent}% off.` : ''}`;
  const { data: lead, error: lerr } = await admin.from('leads').insert({
    source: staff ? 'manual' : 'web',
    status: 'new',
    customer_type: 'residential',
    customer_id: customerId,
    first_name: b.first_name,
    last_name: b.last_name,
    phone: b.phone,
    email: b.email,
    street: b.street,
    unit: b.unit,
    city: b.city,
    state: b.state,
    zip: b.zip,
    gate_code: b.gate_code,
    warnings: b.warnings,
    ...leadFieldsFor(b.kind),
    service_requested: services.join(', ').slice(0, 300),
    notes: [prefix, b.notes].filter(Boolean).join(' '),
    intake: { booking: staff ? 'in_person' : 'online' },
    created_by: staff?.id ?? null,
  }).select('id,first_name,last_name,company_name,phone,email,street').single();
  if (lerr || !lead) {
    console.error('booking: lead insert failed:', lerr?.message);
    if (offerRow) await releaseOffer(admin, offerRow.id);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
  const undo = async () => { await admin.from('leads').delete().eq('id', lead.id); if (offerRow) await releaseOffer(admin, offerRow.id); };
  if (offerRow) await admin.from('slowday_offers').update({ lead_id: lead.id }).eq('id', offerRow.id);

  // The estimate: sent, then approved, so the database moves the lead to "Ready to schedule" the usual way.
  const stamp = now.toISOString();
  const { data: est, error: eerr } = await admin.from('estimates').insert({
    lead_id: lead.id, status: 'sent', minimum_charge: priced.minimum, sent_at: stamp,
  }).select('id,share_token').single();
  if (eerr || !est) { console.error('booking: estimate insert failed:', eerr?.message); await undo(); return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 }); }

  const { error: nerr } = await admin.from('estimate_lines').insert(
    finalLines.map((l) => ({ estimate_id: est.id, price_item_id: l.price_item_id, description: l.description, unit: l.unit, quantity: l.quantity, unit_price: l.unit_price, is_custom: !!l.is_custom, sort_order: l.sort_order })),
  );
  if (nerr) { console.error('booking: lines insert failed:', nerr.message); await undo(); return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 }); }

  const { error: aerr } = await admin.from('estimates').update({ status: 'approved', approved_at: stamp }).eq('id', est.id).eq('status', 'sent');
  if (aerr) { console.error('booking: approve failed:', aerr.message); await undo(); return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 }); }

  const snapshot = estimateSnapshot(finalLines, priced.minimum);
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
  const { error: serr } = await admin.from('estimate_signatures').insert({
    estimate_id: est.id,
    signer_name: b.signerName,
    signature_png: b.signature,
    signed_at: stamp,
    ip,
    user_agent: (request.headers.get('user-agent') || '').slice(0, 300),
    total_cents: finalTotals.totalCents,
    minimum_charge: snapshot.minimum_charge,
    lines_snapshot: snapshot.lines,
    preferred_times: '',
    chosen_tier: null,
  });
  if (serr) { console.error('booking: signature insert failed:', serr.message); await undo(); return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 }); }

  // History for the lead (it moves onto the job when the work order is created).
  await admin.from('job_events').insert({
    lead_id: lead.id,
    actor_id: staff?.id ?? null,
    actor_email: staff?.email ?? null,
    kind: staff ? 'booked_in_person' : 'booked_online',
    details: { signer_name: b.signerName, total_cents: finalTotals.totalCents, services, requested: b.slot || 'later', ip, ...(offerRow ? { slowday_offer_percent: offerRow.percent } : {}) },
  });

  const out = { ok: true, estimate_token: est.share_token, tz: settings.timezone || 'America/Chicago', ...(staff ? { lead_id: lead.id } : {}) };
  if (!b.slot) return NextResponse.json({ ...out, scheduled: false });

  const booked = await bookSlot(admin, lead.id, chosen.start);
  if (booked.error) {
    // The approval stands. The customer picks another time from their estimate page.
    return NextResponse.json({ ...out, scheduled: false, error: booked.error, code: booked.code }, { status: booked.status });
  }
  await sendBookingConfirmation({
    admin, jobId: booked.jobId, settings, lead, startIso: chosen.start, endIso: chosen.end, link: `${siteUrl(request)}/e/${est.share_token}`,
  });
  return NextResponse.json({ ...out, scheduled: true, start: chosen.start, end: chosen.end, ...(staff ? { job_id: booked.jobId } : {}) });
}
