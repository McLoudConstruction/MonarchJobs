'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { loadGoogleMaps } from '@/lib/googleMapsBrowser';
import { colorHex } from '@/lib/userColors';
import { staffName } from '@/lib/userDisplay';
import { fmtTime, fmtDuration } from '@/lib/format';
import RouteOrderCard from '@/components/schedule/RouteOrderCard';

const todayStr = () => new Date().toLocaleDateString('en-CA');

// Office and owner: the day's visits on a map, numbered per tech in time order, colored by tech. Pins appear after each
// address is looked up once (saved afterward). Below the map, each tech with three or more stops can get a suggested order.
export default function MapView({ techs, token }) {
  const [date, setDate] = useState(todayStr());
  const [techId, setTechId] = useState('');
  const [visits, setVisits] = useState([]);
  const [coords, setCoords] = useState({});
  const [failed, setFailed] = useState([]);
  const [notice, setNotice] = useState('');
  const [mapError, setMapError] = useState('');
  const [loading, setLoading] = useState(true);
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markers = useRef([]);

  const load = useCallback(async () => {
    setLoading(true); setNotice('');
    const from = new Date(`${date}T00:00:00`);
    const to = new Date(from.getTime() + 86400000);
    const { data, error } = await getSupabase().from('job_visits')
      .select('id,tech_id,starts_at,duration_minutes,status,job:jobs(id,job_number,customer:customers(display_name),address:addresses(id,street,city,lat,lng,geocode_status))')
      .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).neq('status', 'cancelled').order('starts_at');
    if (error) { setNotice(error.message); setLoading(false); return; }
    const rows = data || [];
    setVisits(rows);
    const known = {};
    const need = [];
    for (const v of rows) {
      const a = v.job?.address;
      if (!a) continue;
      if (a.lat != null && a.lng != null) known[a.id] = { lat: a.lat, lng: a.lng };
      else if (a.geocode_status !== 'failed') need.push(a.id);
    }
    setFailed(rows.map((v) => v.job?.address).filter((a) => a && a.geocode_status === 'failed').map((a) => a.id));
    setCoords(known);
    setLoading(false);
    // look up the addresses that do not have pins yet (saved for next time)
    let ids = [...new Set(need)];
    for (let round = 0; round < 5 && ids.length; round += 1) {
      try {
        const r = await apiFetch('/api/schedule/geocode', token, { method: 'POST', body: JSON.stringify({ address_ids: ids }) });
        setCoords((c) => ({ ...c, ...r.coords }));
        if (r.failed?.length) setFailed((f) => [...new Set([...f, ...r.failed])]);
        if (r.error) { setNotice(r.error); break; }
        ids = ids.filter((id) => !r.coords[id] && !(r.failed || []).includes(id));
        if (!r.remaining) break;
      } catch (e) { setNotice(e.message); break; }
    }
  }, [date, token]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => visits.filter((v) => !techId || v.tech_id === techId), [visits, techId]);
  // numbering is per tech in time order
  const numbered = useMemo(() => {
    const count = {};
    return shown.map((v) => { const k = v.tech_id || 'none'; count[k] = (count[k] || 0) + 1; return { ...v, n: count[k] }; });
  }, [shown]);

  useEffect(() => {
    let live = true;
    loadGoogleMaps().then((maps) => {
      if (!live || !mapEl.current) return;
      if (!mapRef.current) mapRef.current = new maps.Map(mapEl.current, { center: { lat: 37.08, lng: -94.5 }, zoom: 11, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
      markers.current.forEach((m) => m.setMap(null));
      markers.current = [];
      const bounds = new maps.LatLngBounds();
      const info = new maps.InfoWindow();
      for (const v of numbered) {
        const c = v.job?.address && coords[v.job.address.id];
        if (!c) continue;
        const tech = techs.find((t) => t.id === v.tech_id);
        const hex = v.tech_id ? colorHex(tech, techs) : '#6b7686';
        const m = new maps.Marker({
          position: c, map: mapRef.current,
          label: { text: String(v.n), color: '#fff', fontWeight: '700' },
          icon: { path: maps.SymbolPath.CIRCLE, scale: 14, fillColor: hex, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
        });
        m.addListener('click', () => {
          const box = document.createElement('div');
          box.style.fontSize = '14px';
          const t1 = document.createElement('strong'); t1.textContent = `#${v.job?.job_number ?? ''} ${v.job?.customer?.display_name || ''}`;
          const t2 = document.createElement('div'); t2.textContent = `${fmtTime(v.starts_at)} for ${fmtDuration(v.duration_minutes)} · ${tech ? staffName(tech) : 'Unassigned'}`;
          const t3 = document.createElement('div'); t3.textContent = `${v.job?.address?.street || ''}, ${v.job?.address?.city || ''}`;
          box.append(t1, t2, t3);
          info.setContent(box); info.open({ map: mapRef.current, anchor: m });
        });
        markers.current.push(m);
        bounds.extend(c);
      }
      if (markers.current.length === 1) { mapRef.current.setCenter(bounds.getCenter()); mapRef.current.setZoom(14); }
      else if (markers.current.length > 1) mapRef.current.fitBounds(bounds, 48);
    }).catch((e) => { if (live) setMapError(e.message); });
    return () => { live = false; };
  }, [numbered, coords, techs]);

  const byTech = useMemo(() => {
    const m = new Map();
    for (const v of visits) { if (!v.tech_id) continue; m.set(v.tech_id, [...(m.get(v.tech_id) || []), v]); }
    return [...m.entries()].filter(([id, list]) => (!techId || id === techId) && list.filter((v) => v.status === 'scheduled').length >= 3);
  }, [visits, techId]);
  const unplaced = numbered.filter((v) => v.job?.address && !coords[v.job.address.id]).length;
  const unassigned = numbered.filter((v) => !v.tech_id).length;

  return (
    <div>
      <div className="toolbar">
        <input type="date" aria-label="Day" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="secondary" onClick={() => setDate(todayStr())}>Today</button>
        <select aria-label="Tech" value={techId} onChange={(e) => setTechId(e.target.value)}>
          <option value="">All techs</option>
          {techs.filter((t) => t.role === 'tech' || t.role === 'owner').map((t) => <option key={t.id} value={t.id}>{staffName(t)}</option>)}
        </select>
        <span className="muted">{numbered.length} {numbered.length === 1 ? 'visit' : 'visits'}{unassigned ? ` (${unassigned} unassigned, grey)` : ''}</span>
      </div>
      {mapError && <div className="banner flag">{mapError}</div>}
      {notice && <div className="banner flag">{notice}</div>}
      {unplaced > 0 && !loading && !notice && <p className="hint">{unplaced} {unplaced === 1 ? 'stop is' : 'stops are'} not on the map yet{failed.length ? `, ${failed.length} could not be found. Check the address on the job` : ''}.</p>}
      <div ref={mapEl} style={{ width: '100%', height: 420, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2, #eef1f5)' }} />
      <ol style={{ listStyle: 'none', padding: 0, margin: '12px 0' }}>
        {numbered.map((v) => {
          const tech = techs.find((t) => t.id === v.tech_id);
          return (
            <li key={v.id} className="row" style={{ gap: 10, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <span aria-hidden="true" style={{ background: v.tech_id ? colorHex(tech, techs) : '#6b7686', color: '#fff', borderRadius: 999, minWidth: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{v.n}</span>
              <span>{fmtTime(v.starts_at)} · #{v.job?.job_number} {v.job?.customer?.display_name} · {v.job?.address?.street}, {v.job?.address?.city} · {tech ? staffName(tech) : 'Unassigned'}</span>
            </li>
          );
        })}
        {!loading && numbered.length === 0 && <li className="muted">Nothing scheduled this day.</li>}
      </ol>
      {byTech.map(([id]) => <RouteOrderCard key={`${id}-${date}`} date={date} tech={techs.find((t) => t.id === id)} techId={id} token={token} onApplied={load} />)}
    </div>
  );
}
