import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { ensureCoords, driveMatrix } from '@/lib/googleServer';
import { planRoute, REASON_TEXT, MAX_STOPS } from '@/lib/routeOrder';
import { zonedToUtcMs, addDaysStr } from '@/lib/booking';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Office and owner. One tech, one day.
//   { action: 'suggest', date, tech_id } -> the plan (changes nothing)
//   { action: 'apply', date, tech_id, visit_ids } -> works the plan out again and applies it only if it is the same set of visits
async function build(admin, date, techId) {
  const { data: set } = await admin.from('settings').select('timezone').eq('id', 1).maybeSingle();
  const tz = set?.timezone || 'America/Chicago';
  const [y, m, d] = date.split('-').map(Number);
  const from = new Date(zonedToUtcMs(y, m, d, 0, 0, tz)).toISOString();
  const [ny, nm, nd] = addDaysStr(date, 1).split('-').map(Number);
  const to = new Date(zonedToUtcMs(ny, nm, nd, 0, 0, tz)).toISOString();
  const { data: visits, error } = await admin.from('job_visits')
    .select('id,job_id,starts_at,ends_at,duration_minutes,job:jobs(job_number,address:addresses(id,street,unit,city,state,zip,lat,lng,geocode_status))')
    .eq('tech_id', techId).eq('status', 'scheduled').gte('starts_at', from).lt('starts_at', to).order('starts_at');
  if (error) return { error: 'Could not read the schedule.' };
  const stops = visits || [];
  if (stops.length > MAX_STOPS) return { plan: planRoute({ stops: stops.map((s) => ({ id: s.id, starts_at: s.starts_at, duration_minutes: s.duration_minutes })), matrix: [] }), stops };
  if (stops.length < 3) return { plan: planRoute({ stops: stops.map((s) => ({ id: s.id, starts_at: s.starts_at, duration_minutes: s.duration_minutes })), matrix: [] }), stops };

  const addrs = stops.map((s) => s.job?.address).filter(Boolean);
  const g = await ensureCoords(admin, addrs, 20);
  if (g.error) return { error: g.error };
  const missing = stops.filter((s) => !s.job?.address || !g.coords.has(s.job.address.id));
  if (missing.length) {
    return { plan: { ok: false, reason: 'unknown', moves: [] }, stops, note: `${missing.length} stop${missing.length === 1 ? '' : 's'} could not be placed on the map, so no order is suggested. Check ${missing.length === 1 ? 'that address' : 'those addresses'}.` };
  }
  const dm = await driveMatrix(stops.map((s) => g.coords.get(s.job.address.id)));
  if (dm.error) return { error: dm.error };
  const plan = planRoute({ stops: stops.map((s) => ({ id: s.id, starts_at: s.starts_at, duration_minutes: s.duration_minutes })), matrix: dm.matrix });
  return { plan, stops };
}

const label = (s) => `#${s.job?.job_number ?? ''} ${s.job?.address?.street || ''}`.trim();

export async function POST(request) {
  const auth = await requireStaff(request, ['owner', 'office']);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => ({}));
  if (!DATE.test(String(body.date || '')) || !UUID.test(String(body.tech_id || ''))) return NextResponse.json({ error: 'Pick a day and a tech.' }, { status: 400 });
  const admin = getAdmin();
  const r = await build(admin, body.date, body.tech_id);
  if (r.error) return NextResponse.json({ error: r.error }, { status: 502 });
  const { plan, stops } = r;
  const by = new Map(stops.map((s) => [s.id, s]));
  const view = {
    ok: plan.ok, reason: plan.reason, message: r.note || REASON_TEXT[plan.reason] || '',
    savedMinutes: Math.round((plan.savedSeconds || 0) / 60), currentMinutes: Math.round((plan.current || 0) / 60), suggestedMinutes: Math.round((plan.suggested || 0) / 60),
    current: stops.map((s) => ({ id: s.id, start: s.starts_at, label: label(s) })),
    suggested: plan.order ? plan.order.map((idx, slot) => ({ id: stops[idx].id, start: stops[slot].starts_at, label: label(stops[idx]) })) : [],
    moves: plan.moves.map((m) => m.id),
  };

  if (body.action !== 'apply') return NextResponse.json(view);

  if (!plan.ok) return NextResponse.json({ error: view.message || 'There is nothing to apply.' }, { status: 409 });
  const wanted = [...(Array.isArray(body.visit_ids) ? body.visit_ids : [])].sort().join(',');
  const have = [...plan.moves.map((m) => m.id)].sort().join(',');
  if (wanted !== have) return NextResponse.json({ error: 'The schedule changed since you looked. Please check the suggestion again.' }, { status: 409 });

  let applied = 0;
  for (const mv of plan.moves) {
    const { error } = await admin.from('job_visits').update({ starts_at: mv.newStart, ends_at: mv.newEnd }).eq('id', mv.id).eq('status', 'scheduled');
    if (error) { console.error('route order apply failed:', error.message); return NextResponse.json({ error: `Applied ${applied} of ${plan.moves.length}. Please check the schedule.` }, { status: 500 }); }
    applied += 1;
    const s = by.get(mv.id);
    await admin.from('job_events').insert({ job_id: s.job_id, actor_id: auth.staff.id, actor_email: auth.staff.email, kind: 'route_reordered', details: { from: s.starts_at, to: mv.newStart } });
  }
  return NextResponse.json({ ...view, applied });
}
