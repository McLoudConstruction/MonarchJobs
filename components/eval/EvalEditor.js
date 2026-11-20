'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';
import { cleanEval, evalTotal } from '@/lib/evalSheet';
import { EVAL_STATUSES, EVAL_PICKABLE, EVAL_BUCKET } from '@/lib/evals';
import EvalFields from '@/components/eval/EvalFields';
import EvalPhotos from '@/components/eval/EvalPhotos';
import PropertyForm from '@/components/eval/PropertyForm';
import './evals.css';

const SAVE_DELAY_MS = 800;

// One eval: the property and unit, the sheet filled in like the paper form (priced as it goes), and the pictures.
// Saves by itself a moment after each change. `onClose()` goes back to the list after anything pending is saved.
export default function EvalEditor({ row, properties, isOwner, onClose, onPropertySaved, onDeleted }) {
  const canEdit = row.status !== 'converted';
  const [doc, setDoc] = useState(() => ({ data: cleanEval(row.data), status: row.status, propertyId: row.property_id }));
  const [photos, setPhotos] = useState([]);
  const [saveText, setSaveText] = useState('');
  const [propForm, setPropForm] = useState(null); // { property } to edit, { property: null } to add
  const [msg, setMsg] = useState(null);
  const timer = useRef(null);
  const latest = useRef(doc);
  latest.current = doc;
  const propsRef = useRef(properties);
  propsRef.current = properties;

  const save = useCallback(async (next) => {
    const prop = propsRef.current.find((p) => p.id === next.propertyId);
    const d = cleanEval({ ...next.data, complex: prop?.name || next.data.complex });
    const { error } = await getSupabase().from('evals').update({
      property_id: next.propertyId, status: next.status, data: d, eval_date: d.date || null, total_cents: Math.round(evalTotal(d) * 100),
    }).eq('id', row.id);
    return error;
  }, [row.id]);

  const persist = useCallback((next) => {
    clearTimeout(timer.current);
    setSaveText('Saving...');
    timer.current = setTimeout(async () => {
      timer.current = null;
      const error = await save(next);
      setSaveText(error ? 'Could not save. Check your connection.' : 'Saved');
    }, SAVE_DELAY_MS);
  }, [save]);

  // leaving the screen with a change still waiting: send it now
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); save(latest.current).then(() => {}); }
  }, [save]);

  useEffect(() => {
    let live = true;
    getSupabase().from('eval_photos').select('*').eq('eval_id', row.id).order('created_at')
      .then(({ data }) => { if (live) setPhotos(data || []); });
    return () => { live = false; };
  }, [row.id]);

  const change = (fn) => { if (!canEdit) return; setDoc((d) => { const next = fn({ ...d, data: structuredClone(d.data) }); persist(next); return next; }); };
  const setData = (fn) => change((d) => ({ ...d, data: fn(d.data) }));
  const text = (k) => (e) => setData((d) => { d[k] = e.target.value; return d; });

  async function close() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      const error = await save(latest.current);
      if (error) { setMsg({ err: true, text: 'Could not save the last change. Check your connection, then go back again.' }); setSaveText('Could not save.'); return; }
    }
    onClose();
  }

  async function remove() {
    if (!window.confirm('Delete this eval and its pictures? This cannot be undone.')) return;
    const sb = getSupabase();
    const paths = photos.flatMap((p) => [p.storage_path, p.thumb_path]);
    if (paths.length) await sb.storage.from(EVAL_BUCKET).remove(paths);
    const { error } = await sb.from('evals').delete().eq('id', row.id);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    clearTimeout(timer.current);
    timer.current = null;
    onDeleted();
  }

  const property = properties.find((p) => p.id === doc.propertyId);
  const contacts = property && [
    property.manager_name || property.manager_phone || property.manager_email ? `Manager: ${[property.manager_name, property.manager_phone].filter(Boolean).join(' · ') || property.manager_email}` : '',
    property.maint_name || property.maint_phone || property.maint_email ? `Maintenance: ${[property.maint_name, property.maint_phone].filter(Boolean).join(' · ') || property.maint_email}` : '',
  ].filter(Boolean);

  return (
    <div className="es-edit ev-edit">
      <div className="es-head">
        <button type="button" className="secondary" onClick={close}>Back to evals</button>
        <span className="muted es-save">{saveText}</span>
      </div>
      {msg && <div className={`banner ${msg.err ? 'flag' : 'ok'}`}>{msg.text}</div>}
      {!canEdit && (
        <p className="hint">This eval became a work order, so it can no longer be changed.{row.job_id && <> <Link href={`/jobs/${row.job_id}`}>Open the job</Link></>}</p>
      )}

      <div className="card es-card">
        <h3>Eval</h3>
        <div className="es-grid">
          <div className="field es-wide">
            <label>Property</label>
            <div className="ev-prop-pick">
              <select value={doc.propertyId} disabled={!canEdit} onChange={(e) => change((d) => ({ ...d, propertyId: e.target.value }))} aria-label="Property">
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {canEdit && <button type="button" className="secondary small" onClick={() => setPropForm({ property: null })}>Add property</button>}
              {property && canEdit && <button type="button" className="secondary small" onClick={() => setPropForm({ property })}>Edit property</button>}
            </div>
            {contacts?.length > 0 && <p className="hint" style={{ margin: '6px 0 0' }}>{contacts.join('   ')}</p>}
          </div>
          <div className="field"><label>Building</label><input value={doc.data.building} disabled={!canEdit} onChange={text('building')} /></div>
          <div className="field"><label>Unit</label><input value={doc.data.unit} disabled={!canEdit} onChange={text('unit')} /></div>
          <div className="field"><label>Date</label><input type="date" value={doc.data.date} disabled={!canEdit} onChange={text('date')} /></div>
          <div className="field es-wide">
            <label>Status</label>
            {canEdit ? (
              <div className="ev-status-pick" role="radiogroup" aria-label="Status">
                {EVAL_PICKABLE.map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={doc.status === k} className={`ev-status-btn${doc.status === k ? ' on' : ''}`}
                    onClick={() => change((d) => ({ ...d, status: k }))}>{EVAL_STATUSES[k]}</button>
                ))}
              </div>
            ) : <span className={`badge ev-s-${doc.status}`}>{EVAL_STATUSES[doc.status]}</span>}
          </div>
        </div>
      </div>

      <EvalFields data={doc.data} set={setData} canEdit={canEdit} />

      <div className="card es-card">
        <EvalPhotos evalId={row.id} kind="unit" label="Unit photos" photos={photos} canEdit={canEdit} onChange={setPhotos}
          hint="Damage, stains or anything the price is based on." />
        <EvalPhotos evalId={row.id} kind="paper" label="Paper copy" photos={photos} canEdit={canEdit} onChange={setPhotos}
          hint="Photos of the filled-in paper sheet, if one was written by hand." />
      </div>

      {isOwner && canEdit && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="secondary danger" onClick={remove}>Delete this eval</button>
        </div>
      )}

      {propForm && (
        <PropertyForm key={propForm.property?.id || 'new'} open property={propForm.property} onClose={() => setPropForm(null)}
          onSaved={(saved) => {
            const adding = !propForm.property;
            propsRef.current = [...propsRef.current.filter((p) => p.id !== saved.id), saved];
            onPropertySaved(saved);
            setPropForm(null);
            if (adding) change((d) => ({ ...d, propertyId: saved.id }));
            else persist(latest.current); // the sheet carries the property's name
          }} />
      )}
    </div>
  );
}
