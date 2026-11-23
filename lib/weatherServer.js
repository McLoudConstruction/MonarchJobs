// Server side of weather alerts (push 2C): asks the National Weather Service, saves the alerts, tells the right people,
// and runs the owner-approved storm message. Server only.
import { parseLocation, parseNwsAlerts, alertsToEnd, summarizeCapacity, planStormOffers, buildStormMessages, stormDedupe, STORM_SKIP_LABELS } from './weather.js';
import { geocodeAddress } from './googleServer.js';
import { loadBookingSettings, loadOpenSlots } from './bookingServer.js';
import { loadOutreachInputs } from './outreachServer.js';
import { normalizeBooking } from './booking.js';
import { sendSms, sendEmail } from './notify.js';

// ------------------------------------------------------------------ the weather service
async function resolvePoint(admin, settings) {
  const loc = parseLocation(settings.weather_location);
  if (!loc) return { error: 'Add a ZIP code (or coordinates) for the alert area in Settings > Outreach.' };
  if (loc.lat != null) return { lat: loc.lat, lng: loc.lng };
  if (settings.weather_geo_for === loc.zip && settings.weather_lat != null && settings.weather_lng != null) {
    return { lat: settings.weather_lat, lng: settings.weather_lng };
  }
  const g = await geocodeAddress({ zip: loc.zip });
  if (g.lat != null) {
    await admin.from('settings').update({ weather_lat: g.lat, weather_lng: g.lng, weather_geo_for: loc.zip }).eq('id', 1);
    return { lat: g.lat, lng: g.lng };
  }
  return { error: g.error || 'That ZIP code could not be found. Try coordinates like 37.21, -93.29.' };
}

async function fetchActiveAlerts(point, settings) {
  const contact = settings.email || settings.business_name || 'monarchjobs';
  const res = await fetch(`https://api.weather.gov/alerts/active?point=${point.lat.toFixed(4)},${point.lng.toFixed(4)}`, {
    headers: { 'User-Agent': `MonarchJobs (${contact})`, Accept: 'application/geo+json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`The weather service answered ${res.status}.`);
  return res.json();
}

// Called every 30 minutes. dryRun only lists what is active for the area (the owner's "Check the weather now" button); nothing is saved or sent.
export async function runWeatherCheck({ admin, dryRun = false, now = new Date() }) {
  const { data: settings } = await admin.from('settings').select('*').eq('id', 1).maybeSingle();
  if (!settings) return { skipped: 'no settings' };
  if (!dryRun && !settings.storm_enabled && !settings.freeze_enabled) return { skipped: 'off' };

  const point = await resolvePoint(admin, settings);
  if (point.error) return { error: point.error };
  const json = await fetchActiveAlerts(point, settings);
  // For the owner's check, every alert counts so they can see what the area has; the saved list follows the switches.
  const alerts = parseNwsAlerts(json, dryRun ? { ...settings, storm_enabled: true, freeze_enabled: true } : settings);
  if (dryRun) return { dryRun: true, active: alerts.map((a) => ({ event: a.event, kind: a.kind, headline: a.headline, area: a.area, expires_at: a.expires_at })) };

  const ids = alerts.map((a) => a.nws_id);
  const { data: known } = ids.length ? await admin.from('weather_alerts').select('nws_id').in('nws_id', ids) : { data: [] };
  const have = new Set((known || []).map((k) => k.nws_id));
  const fresh = alerts.filter((a) => !have.has(a.nws_id));
  let notified = 0;
  if (fresh.length) {
    const rows = fresh.map((a) => ({ ...a, note: a.kind === 'freeze' ? String(settings.freeze_precautions || '').slice(0, 600) : '' }));
    const { data: inserted, error } = await admin.from('weather_alerts').upsert(rows, { onConflict: 'nws_id', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(error.message);
    for (const r of inserted || []) {
      const { error: nerr } = await admin.rpc('weather_notify', { p_id: r.id });
      if (nerr) console.error('weather_notify failed:', nerr.message); else notified += 1;
    }
  }

  // Close what the service no longer lists, or whose time ran out.
  const { data: saved } = await admin.from('weather_alerts').select('id,nws_id,status,expires_at').in('status', ['open', 'sent']);
  const ending = alertsToEnd(saved || [], new Set(ids), now);
  if (ending.length) await admin.rpc('weather_end', { p_ids: ending });
  return { ok: true, active: alerts.length, new: fresh.length, notified, ended: ending.length };
}

// ------------------------------------------------------------------ the storm check and message
async function loadAlert(admin, alertId) {
  const { data } = await admin.from('weather_alerts').select('*').eq('id', alertId).maybeSingle();
  return data && data.kind === 'storm' ? data : null;
}

export async function loadStormPlan(admin, alertId, now = new Date()) {
  const alert = await loadAlert(admin, alertId);
  if (!alert) return { error: 'Alert not found.', status: 404 };
  const [{ data: full }, booking] = await Promise.all([admin.from('settings').select('*').eq('id', 1).maybeSingle(), loadBookingSettings(admin)]);
  const settings = full || {};
  const tz = normalizeBooking(booking).tz;
  const open = await loadOpenSlots(admin, booking, now);
  const capacity = summarizeCapacity(open.days, { now, tz, windowDays: settings.storm_window_days || 5 });

  const inputs = await loadOutreachInputs(admin);
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const [recent, followups, offeredRows] = await Promise.all([
    admin.from('outreach_log').select('customer_id').gte('at', since),
    admin.from('estimate_followups').select('keys').gte('at', since),
    admin.from('outreach_log').select('customer_id').eq('dedupe_key', stormDedupe(alertId)),
  ]);
  const blocked = new Set([
    ...(recent.data || []).map((r) => `c:${r.customer_id}`),
    ...(followups.data || []).flatMap((r) => r.keys || []),
  ]);
  const plan = planStormOffers({ customers: inputs.customers, blocked, offered: (offeredRows.data || []).map((r) => r.customer_id), settings });
  return { alert, settings, capacity, plan };
}

// What the office sees before approving: the alert, the open times in the next few days, and who would be messaged.
export async function previewStorm(admin, alertId, now = new Date()) {
  const r = await loadStormPlan(admin, alertId, now);
  if (r.error) return r;
  const counts = {};
  for (const s of r.plan.skipped) counts[s.label] = (counts[s.label] || 0) + 1;
  return {
    alert: { id: r.alert.id, event: r.alert.event, headline: r.alert.headline, area: r.alert.area, expires_at: r.alert.expires_at, status: r.alert.status, sent_count: r.alert.sent_count },
    capacity: r.capacity,
    canSend: r.alert.status === 'open' && r.capacity.total > 0,
    blockedReason: r.alert.status !== 'open' ? 'This alert has already been handled.' : r.capacity.total === 0 ? 'There are no open times in the next few days, so there is nothing to offer yet.' : '',
    overflow: r.plan.overflow,
    skipped: Object.entries(counts).map(([label, count]) => ({ label, count })),
    items: r.plan.eligible.map((c) => ({ customer_id: c.id, name: c.display_name, phone: !!c.phone, email: !!c.email })),
    sample: buildStormMessages({ business: r.settings.business_name, custom: r.settings.storm_message, firstName: 'Alex', link: 'https://…' }).sms,
  };
}

// Sends to the people left ticked. This is the approval: nothing goes out before it. Anyone no longer eligible is skipped.
export async function sendStorm({ admin, origin, alertId, customerIds, staffId = null, now = new Date() }) {
  const r = await loadStormPlan(admin, alertId, now);
  if (r.error) return r;
  if (r.alert.status !== 'open') return { error: 'This alert has already been handled.', status: 409 };
  if (r.capacity.total === 0) return { error: 'There are no open times in the next few days, so there is nothing to offer yet.', status: 409 };
  const chosen = new Set(customerIds || []);
  const targets = r.plan.eligible.filter((c) => chosen.has(c.id));
  let sent = 0;
  const failed = [];
  for (const c of targets) {
    const link = `${origin}/c/${c.last_job.token}`;
    const m = buildStormMessages({ business: r.settings.business_name, custom: r.settings.storm_message, firstName: c.first_name, link });
    const [sms, email] = await Promise.all([
      c.phone ? sendSms({ to: c.phone, body: m.sms }) : { status: 'skipped', detail: 'No phone number on file.' },
      c.email ? sendEmail({ to: c.email, subject: m.subject, html: m.html, text: m.text }) : { status: 'skipped', detail: 'No email on file.' },
    ]);
    if (sms.status !== 'sent' && email.status !== 'sent') { failed.push({ customer: c.display_name, sms: sms.detail, email: email.detail }); continue; }
    const { error } = await admin.from('outreach_log').insert({
      customer_id: c.id, job_id: c.last_job.id, kind: 'storm_offer', dedupe_key: stormDedupe(alertId),
      results: { sms: { status: sms.status, detail: sms.detail }, email: { status: email.status, detail: email.detail } },
    });
    if (!error) sent += 1;
  }
  if (sent > 0) await admin.rpc('weather_alert_mark_sent', { p_id: alertId, p_count: sent, p_user: staffId });
  return { sent, failed: failed.slice(0, 10), notSent: (customerIds || []).length - targets.length };
}

export { STORM_SKIP_LABELS };
