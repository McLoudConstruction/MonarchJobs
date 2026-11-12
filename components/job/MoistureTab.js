'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { normalizePlan } from '@/lib/sketch';
import SketchCanvas from '@/components/job/SketchCanvas';

const SAVE_DELAY_MS = 1200;

// Moisture tab: the sketch as a plain floorplan with a layer per affected area. Tap to place a reading point,
// tap a pin to log a recheck. Points live in the sketch's plan, so they save the same way the sketch does.
export default function MoistureTab({ sketches, startId = null, onActive, staff = null, staffList = [], onOpenSketch }) {
  const [activeId, setActiveId] = useState(startId);
  const [loaded, setLoaded] = useState(null); // { id, name, plan }
  const [loadErr, setLoadErr] = useState('');
  const [save, setSave] = useState({ state: 'idle', text: '' });
  const [headSlot, setHeadSlot] = useState(null);

  const stamps = useRef({});
  const pending = useRef(null);
  const timer = useRef(0);
  const saving = useRef(false);

  useEffect(() => {
    if (!sketches.length) { setActiveId(null); return; }
    if (!sketches.some((s) => s.id === activeId)) setActiveId(sketches[0].id);
  }, [sketches, activeId]);
  useEffect(() => { if (activeId) onActive?.(activeId); }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const job = pending.current;
    if (!job || saving.current) return;
    pending.current = null;
    saving.current = true;
    setSave({ state: 'saving', text: 'Saving...' });
    const q = getSupabase().from('job_sketches').update({ plan: job.plan }).eq('id', job.id);
    const seen = stamps.current[job.id];
    const { data, error } = await (seen ? q.eq('updated_at', seen) : q).select('updated_at');
    saving.current = false;
    if (error) {
      pending.current = pending.current || job;
      setSave({ state: 'error', text: `Not saved: ${error.message}` });
    } else if (!data || data.length === 0) {
      pending.current = null;
      setSave({ state: 'conflict', text: 'This sketch was changed on another device, so your last reading was not saved. Reload to see the latest.' });
    } else {
      stamps.current[job.id] = data[0].updated_at;
      setSave({ state: 'saved', text: 'Saved' });
    }
    if (pending.current) timer.current = setTimeout(flush, 300);
  }, []);

  const queueSave = useCallback((id, plan) => {
    pending.current = { id, plan };
    setSave({ state: 'dirty', text: 'Saving...' });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const load = useCallback(async (id) => {
    setLoaded(null);
    setLoadErr('');
    const { data, error } = await getSupabase().from('job_sketches').select('id,name,plan,updated_at').eq('id', id).maybeSingle();
    if (error || !data) { setLoadErr(error?.message || 'Could not open this sketch.'); return; }
    stamps.current[data.id] = data.updated_at;
    setSave({ state: 'idle', text: '' });
    setLoaded({ id: data.id, name: data.name, plan: normalizePlan(data.plan) });
  }, []);

  useEffect(() => {
    if (!activeId) { setLoaded(null); return; }
    Promise.resolve(flush()).then(() => load(activeId));
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sketches.length) {
    return (
      <div className="card">
        <h2>Moisture</h2>
        <p className="hint">Moisture readings are logged on the floorplan, so build and save a sketch first.</p>
        <button type="button" className="primary" onClick={onOpenSketch}>Go to Sketch</button>
      </div>
    );
  }

  const noRooms = loaded && !loaded.plan.rooms.length;

  return (
    <div className="card sketch-card moist-card">
      <div className="row moist-head" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="sketch-picker" role="tablist" aria-label="Floorplans">
          {sketches.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === activeId} className={s.id === activeId ? 'on' : ''} onClick={() => setActiveId(s.id)}>{s.name}</button>
          ))}
        </div>
        <span className="sketch-head-right"><span className={`sketch-save ${save.state}`} aria-live="polite">{save.state === 'saved' || save.state === 'dirty' || save.state === 'saving' ? save.text : ''}</span><span ref={setHeadSlot} /></span>
      </div>

      {loadErr && <div className="msg err">{loadErr}</div>}
      {(save.state === 'error' || save.state === 'conflict') && (
        <div className="msg err">
          {save.text}{' '}
          {save.state === 'error' && <button type="button" className="secondary small" onClick={flush}>Retry</button>}
          {save.state === 'conflict' && <button type="button" className="secondary small" onClick={() => load(activeId)}>Reload</button>}
        </div>
      )}

      {!loaded && !loadErr && <p className="muted">Opening floorplan...</p>}
      {noRooms && (
        <div>
          <p className="hint">This sketch has no rooms yet. Draw the rooms on the Sketch tab, then come back to log moisture.</p>
          <button type="button" className="primary" onClick={onOpenSketch}>Go to Sketch</button>
        </div>
      )}
      {loaded && !noRooms && (
        <SketchCanvas
          key={loaded.id}
          variant="moisture"
          plan={loaded.plan}
          exportName={`${loaded.name} moisture`}
          headSlot={headSlot}
          staff={staff}
          staffList={staffList}
          onChange={(plan) => queueSave(loaded.id, plan)}
        />
      )}
    </div>
  );
}
