'use client';
// The rooms drawn in a job's sketches, as [{ value: 'sketchId|roomId', label }], for putting a photo in a room.
// A copy is kept on the phone, so the room list is there with no signal too. reloadKey changes when sketches change.
import { useEffect, useState } from 'react';
import { getSupabase } from './supabaseClient';
import { normalizePlan, roomTitle } from './sketch';
import { cacheRead, cacheWrite } from './offlineClient';

export function roomsFromSketches(sketches) {
  const list = sketches || [];
  return list.flatMap((s) => normalizePlan(s.plan).rooms.map((r) => ({
    value: `${s.id}|${r.id}`,
    label: `${list.length > 1 ? `${s.name}: ` : ''}${roomTitle(r)}`,
  })));
}

export function useJobRooms(jobId, reloadKey = 0) {
  const [rooms, setRooms] = useState([]);
  useEffect(() => {
    if (!jobId) return undefined;
    let alive = true;
    const key = `rooms:${jobId}`;
    cacheRead(key).then((c) => { if (alive && Array.isArray(c)) setRooms((cur) => (cur.length ? cur : c)); });
    getSupabase().from('job_sketches').select('id,name,plan').eq('job_id', jobId).order('sort_order').order('created_at').then(({ data, error }) => {
      if (!alive || error || !data) return;
      const next = roomsFromSketches(data);
      setRooms(next);
      cacheWrite(key, next);
    });
    return () => { alive = false; };
  }, [jobId, reloadKey]);
  return rooms;
}
