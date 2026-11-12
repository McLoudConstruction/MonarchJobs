'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { normalizePlan, roomPhotoCounts } from '@/lib/sketch';
import SketchCanvas from '@/components/job/SketchCanvas';

const SAVE_DELAY_MS = 1200;

// Sketch tab: pick or add a sketch (for example one per floor), draw on it, and it saves itself.
// Photos can be attached to a room: they are ordinary job photos that remember sketch + room.
export default function SketchTab({ jobId, sketches, photos, isOffice, staff = null, staffList = [], logEvent, onReload, onAddRoomPhoto, onViewPhotos }) {
  const [activeId, setActiveId] = useState(null);
  const [loaded, setLoaded] = useState(null); // { id, name, plan }
  const [loadErr, setLoadErr] = useState('');
  const [save, setSave] = useState({ state: 'idle', text: '' });
  const [adding, setAdding] = useState(false);
  const [headSlot, setHeadSlot] = useState(null); // where the sketch puts its export and full screen icons
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const stamps = useRef({});      // per sketch: updated_at we last saw, to notice a save from another device
  const pending = useRef(null);   // { id, plan } waiting to be saved
  const timer = useRef(0);
  const saving = useRef(false);

  // keep a valid selection as the list changes
  useEffect(() => {
    if (!sketches.length) { setActiveId(null); return; }
    if (!sketches.some((s) => s.id === activeId)) setActiveId(sketches[0].id);
  }, [sketches, activeId]);

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
      pending.current = pending.current || job; // keep it so the next change or Retry sends it
      setSave({ state: 'error', text: `Not saved: ${error.message}` });
    } else if (!data || data.length === 0) {
      pending.current = null;
      setSave({ state: 'conflict', text: 'This sketch was changed on another device, so your last change was not saved. Reload to see the latest.' });
    } else {
      stamps.current[job.id] = data[0].updated_at;
      setSave({ state: 'saved', text: 'Saved' });
    }
    if (pending.current) timer.current = setTimeout(flush, 300); // changes arrived while saving
  }, []);

  const queueSave = useCallback((id, plan) => {
    pending.current = { id, plan };
    setSave({ state: 'dirty', text: 'Saving...' });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

  // save before leaving: switching sketches, closing the tab, putting the phone away
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
    if (!activeId) { setLoaded(null); return undefined; }
    // finish saving the sketch we are leaving before opening the next
    Promise.resolve(flush()).then(() => load(activeId));
    return undefined;
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addSketch(e) {
    e.preventDefault();
    const name = newName.trim() || `Sketch ${sketches.length + 1}`;
    setBusy(true);
    const { data, error } = await getSupabase().from('job_sketches').insert({ job_id: jobId, name, sort_order: sketches.length }).select('id,name').single();
    setBusy(false);
    if (error) { setLoadErr(error.message); return; }
    await logEvent('sketch_created', { name });
    setAdding(false);
    setNewName('');
    await onReload();
    setActiveId(data.id);
  }

  async function rename(name) {
    const n = name.trim();
    if (!loaded || !n || n === loaded.name) return;
    const { error } = await getSupabase().from('job_sketches').update({ name: n }).eq('id', loaded.id);
    if (error) { setLoadErr(error.message); return; }
    setLoaded({ ...loaded, name: n });
    onReload();
  }

  async function remove() {
    if (!loaded) return;
    if (!window.confirm(`Delete the sketch "${loaded.name}"? Its photos stay on the job.`)) return;
    pending.current = null;
    clearTimeout(timer.current);
    const { error } = await getSupabase().from('job_sketches').delete().eq('id', loaded.id);
    if (error) { setLoadErr(error.message); return; }
    await logEvent('sketch_deleted', { name: loaded.name });
    setLoaded(null);
    setActiveId(null);
    await onReload();
  }

  const counts = loaded ? roomPhotoCounts(photos, loaded.id) : {};

  if (!sketches.length) {
    return (
      <div className="card">
        <h2>Sketch</h2>
        <p className="hint">Draw the rooms for this job: any shape, with angled walls, wall breaks, sizes, notes and photos on each room. Mark where the water went with the Water tool and the wet square footage is worked out for each room. Place moisture points where readings were taken and log each recheck. Shortcuts: V select, R room, B wall break, C corner, W water, P moisture point.</p>
        {loadErr && <div className="msg err">{loadErr}</div>}
        <form className="row" onSubmit={addSketch}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name, for example Main floor" maxLength={60} style={{ flex: 1, minWidth: 180 }} aria-label="Sketch name" />
          <button className="primary" disabled={busy}>Start sketch</button>
        </form>
      </div>
    );
  }

  return (
    <div className="card sketch-card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="sketch-picker" role="tablist" aria-label="Sketches">
          {sketches.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === activeId} className={s.id === activeId ? 'on' : ''} onClick={() => setActiveId(s.id)}>{s.name}</button>
          ))}
          <button type="button" className="add" onClick={() => setAdding(true)}>+ Add sketch</button>
        </div>
        <span className="sketch-head-right"><span className={`sketch-save ${save.state}`} aria-live="polite">{save.state === 'saved' || save.state === 'dirty' || save.state === 'saving' ? save.text : ''}</span><span ref={setHeadSlot} /></span>
      </div>

      {adding && (
        <form className="row" onSubmit={addSketch} style={{ marginBottom: 10 }}>
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`Sketch ${sketches.length + 1} (for example Basement)`} maxLength={60} style={{ flex: 1, minWidth: 180 }} aria-label="New sketch name" />
          <button className="primary small" disabled={busy}>Add</button>
          <button type="button" className="secondary small" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}
      {loadErr && <div className="msg err">{loadErr}</div>}
      {(save.state === 'error' || save.state === 'conflict') && (
        <div className="msg err">
          {save.text}{' '}
          {save.state === 'error' && <button type="button" className="secondary small" onClick={flush}>Retry</button>}
          {save.state === 'conflict' && <button type="button" className="secondary small" onClick={() => load(activeId)}>Reload</button>}
        </div>
      )}

      {!loaded && !loadErr && <p className="muted">Opening sketch...</p>}
      {loaded && (
        <>
          <SketchCanvas
            key={loaded.id}
            plan={loaded.plan}
            exportName={loaded.name}
            headSlot={headSlot}
            staff={staff}
            staffList={staffList}
            onComment={(c) => logEvent('sketch_comment', { sketch: loaded.name, action: c.action, tagged: c.tags })}
            photoCounts={counts}
            onChange={(plan) => queueSave(loaded.id, plan)}
            onAddRoomPhoto={(room) => onAddRoomPhoto(loaded.id, room)}
            onViewRoomPhotos={(room) => onViewPhotos(photos.filter((p) => !p.archived_at && p.sketch_id === loaded.id && p.room_key === room.id))}
          />
          <div className="row" style={{ marginTop: 12 }}>
            <label className="muted" htmlFor="sk-name">Sketch name</label>
            <input id="sk-name" key={loaded.id + loaded.name} defaultValue={loaded.name} maxLength={60} onBlur={(e) => rename(e.target.value)} style={{ maxWidth: 240 }} />
            {isOffice && <button type="button" className="danger small" onClick={remove}>Delete sketch</button>}
          </div>
        </>
      )}
    </div>
  );
}
