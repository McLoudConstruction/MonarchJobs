// Server only. Google Geocoding and Routes calls for the schedule map and the suggested stop order.
// Uses the same server key as address suggestions (GOOGLE_MAPS_API_KEY), which must also allow Geocoding API and Routes API.
import { placesKey } from './places.js';

export const addressText = (a) => [a.street, a.unit, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

// { lat, lng } | { failed: true, reason } | { error } (error = not set up / Google refused: do not mark the address failed)
export async function geocodeAddress(addr) {
  const key = placesKey();
  if (!key) return { error: 'Map lookups are not set up (no GOOGLE_MAPS_API_KEY).' };
  const text = addressText(addr);
  if (!text.trim()) return { failed: true, reason: 'empty' };
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(text)}&region=us&key=${key}`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (body.status === 'OK' && body.results?.[0]?.geometry?.location) {
      const { lat, lng } = body.results[0].geometry.location;
      return { lat, lng };
    }
    if (body.status === 'ZERO_RESULTS') return { failed: true, reason: 'not_found' };
    console.error('geocode refused:', body.status, body.error_message || '');
    return { error: `Google refused the address lookup (${body.status || res.status}). Check that Geocoding API is allowed on the key.` };
  } catch (e) {
    console.error('geocode error:', e.message);
    return { error: 'Address lookup failed. Try again.' };
  }
}

// Drive seconds between every pair of points (traffic not considered, which keeps it in the cheapest Routes tier).
// points: [{ lat, lng }]. Returns { matrix } (null where Google found no route) or { error }.
export async function driveMatrix(points) {
  const key = placesKey();
  if (!key) return { error: 'Route lookups are not set up (no GOOGLE_MAPS_API_KEY).' };
  const wp = points.map((p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } }));
  try {
    const res = await fetch('https://routes.googleapis.com/distance/v2:computeRouteMatrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition' },
      body: JSON.stringify({ origins: wp, destinations: wp, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' }),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error('routes matrix failed', res.status, (await res.text()).slice(0, 300));
      return { error: 'Google would not work out the drive times. Check that Routes API is allowed on the key.' };
    }
    const rows = await res.json();
    const n = points.length;
    const matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : null)));
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r.condition && r.condition !== 'ROUTE_EXISTS') continue;
      const sec = Number.parseFloat(String(r.duration || '').replace('s', ''));
      if (Number.isFinite(sec) && r.originIndex !== r.destinationIndex) matrix[r.originIndex][r.destinationIndex] = sec;
    }
    return { matrix };
  } catch (e) {
    console.error('routes matrix error:', e.message);
    return { error: 'Drive times could not be worked out. Try again.' };
  }
}

// Makes sure these addresses have coordinates, looking up at most `limit` that are missing. Saves what it finds.
// Returns { coords: Map(id -> {lat,lng}), failed: Set(id), error }.
export async function ensureCoords(admin, addresses, limit = 20) {
  const coords = new Map();
  const failed = new Set();
  let error = '';
  let looked = 0;
  for (const a of addresses) {
    if (a.lat != null && a.lng != null) { coords.set(a.id, { lat: a.lat, lng: a.lng }); continue; }
    if (a.geocode_status === 'failed') { failed.add(a.id); continue; }
    if (looked >= limit) continue;
    looked += 1;
    const g = await geocodeAddress(a);
    if (g.error) { error = g.error; break; }
    if (g.failed) {
      failed.add(a.id);
      await admin.from('addresses').update({ geocode_status: 'failed', geocoded_at: new Date().toISOString() }).eq('id', a.id);
    } else {
      coords.set(a.id, { lat: g.lat, lng: g.lng });
      await admin.from('addresses').update({ lat: g.lat, lng: g.lng, geocode_status: 'ok', geocoded_at: new Date().toISOString() }).eq('id', a.id);
    }
  }
  return { coords, failed, error, remaining: addresses.filter((a) => !coords.has(a.id) && !failed.has(a.id)).length };
}

// Drive time right now, with traffic, from one point to another. Returns { seconds } or { error }.
// This is the one Routes call that uses live traffic, so it is only made when a tech taps On the way.
export async function trafficDrive(from, to) {
  const key = placesKey();
  if (!key) return { error: 'Live drive times are not set up (no GOOGLE_MAPS_API_KEY).' };
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.duration' },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE',
      }),
      cache: 'no-store',
    });
    if (!res.ok) { console.error('traffic route failed', res.status, (await res.text()).slice(0, 300)); return { error: 'Google would not work out the drive time. Check that Routes API is allowed on the key.' }; }
    const body = await res.json();
    const sec = Number.parseFloat(String(body.routes?.[0]?.duration || '').replace('s', ''));
    return Number.isFinite(sec) ? { seconds: sec } : { error: 'No route was found.' };
  } catch (e) {
    console.error('traffic route error:', e.message);
    return { error: 'The drive time could not be worked out.' };
  }
}
