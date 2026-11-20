'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSupabase } from '@/lib/supabaseClient';
import PhotoAttach from '@/components/job/PhotoAttach';
import EvalFields from '@/components/eval/EvalFields';
import { fmtDateTime } from '@/lib/format';
import {
  SIZES, ADDONS, EXTRA_ROOM_PRICE, blankEval, cleanEval, evalLines, evalTotal, evalTitle, evalJobTotal, fmtMoney,
} from '@/lib/evalSheet';
import './evalsheet.css';

const SAVE_DELAY_MS = 800;
const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const missingTable = (err) => !!err && (err.code === '42P01' || /does not exist|schema cache|Could not find the table/i.test(err.message || ''));

// The paper layout, shown only when printing (a portal on the page body; the rest of the page is hidden by evalsheet.css).
function PrintSheet({ data }) {
  const d = cleanEval(data);
  const lines = evalLines(d);
  const box = (on) => (on ? '[X]' : '[  ]');
  return (
    <div className="es-print-root">
      <h1>Monarch</h1>
      <p className="es-print-sub">ECO-FRIENDLY CLEANING &amp; RESTORATION</p>
      <h2>Multi-Family Carpet Cleaning Evaluation Form</h2>
      <p>Date: {d.date}</p>
      <p><b>Complex Name:</b> {d.complex}</p>
      <p><b>Building:</b> {d.building} &nbsp;&nbsp; <b>Unit:</b> {d.unit}</p>
      <table>
        <tbody>
          {SIZES.map((s) => (
            <tr key={s.key}><td>{box(d.size === s.key)} {s.label}</td><td className="r">{fmtMoney(s.price)}</td></tr>
          ))}
          <tr><td>Additional Room(s): {d.extra_rooms || ''}</td><td className="r">${EXTRA_ROOM_PRICE} each</td></tr>
        </tbody>
      </table>
      <h3>Additional Services</h3>
      <table>
        <tbody>
          {ADDONS.map((a) => {
            const s = d.services[a.key];
            return <tr key={a.key}><td>{box(s.on)} {a.label}{s.on ? ` (${s.qty} x $${s.price})` : ''}</td><td className="r">{a.note}</td></tr>;
          })}
          {d.others.map((o, i) => <tr key={i}><td>{box(o.on)} Other: {o.label}</td><td className="r">{o.on && o.amount ? fmtMoney(o.amount) : ''}</td></tr>)}
        </tbody>
      </table>
      <p><b>Notes:</b> {d.notes}</p>
      <p>Replacement Needed {box(d.replacement)}</p>
      {lines.length > 0 && (
        <table className="es-print-lines">
          <tbody>{lines.map((l) => <tr key={l.key}><td>{l.label} {l.detail}</td><td className="r">{fmtMoney(l.amount)}</td></tr>)}</tbody>
        </table>
      )}
      <p className="es-print-total"><b>Estimate Total: {fmtMoney(evalTotal(d))}</b></p>
    </div>
  );
}

// One sheet, filled in like the paper form. Saves by itself a moment after each change.
function Editor({ sheet, canEdit, photos, uploader, onOpenPhotos, onClose, onDelete, isOwner }) {
  const [data, setData] = useState(() => cleanEval(sheet.data));
  const [saveText, setSaveText] = useState('');
  const [printing, setPrinting] = useState(false);
  const timer = useRef(null);
  const latest = useRef(data);
  latest.current = data;

  const persist = useCallback((next) => {
    clearTimeout(timer.current);
    setSaveText('Saving...');
    timer.current = setTimeout(async () => {
      timer.current = null;
      const { error } = await getSupabase().from('job_eval_sheets').update({ data: cleanEval(next) }).eq('id', sheet.id);
      setSaveText(error ? 'Could not save. Check your connection.' : 'Saved');
    }, SAVE_DELAY_MS);
  }, [sheet.id]);
  // leaving the screen with a change still waiting: send it now
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      getSupabase().from('job_eval_sheets').update({ data: cleanEval(latest.current) }).eq('id', sheet.id).then(() => {});
    }
  }, [sheet.id]);

  const set = (fn) => { if (!canEdit) return; setData((d) => { const next = fn(structuredClone(d)); persist(next); return next; }); };
  useEffect(() => {
    if (!printing) return undefined;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printing]);

  return (
    <div className="es-edit">
      <div className="es-head">
        <button type="button" className="secondary" onClick={onClose}>Back to sheets</button>
        <span className="muted es-save">{saveText}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="secondary" onClick={() => setPrinting(true)}>Print</button>
      </div>
      {!canEdit && <p className="hint">This job is closed, so the sheet can no longer be changed.</p>}

      <div className="card es-card">
        <h3>Multi-Family Carpet Cleaning Evaluation</h3>
        <div className="es-grid">
          <div className="field es-wide"><label>Complex name</label>
            <input value={data.complex} disabled={!canEdit} onChange={(e) => set((d) => { d.complex = e.target.value; return d; })} /></div>
          <div className="field"><label>Building</label>
            <input value={data.building} disabled={!canEdit} onChange={(e) => set((d) => { d.building = e.target.value; return d; })} /></div>
          <div className="field"><label>Unit</label>
            <input value={data.unit} disabled={!canEdit} onChange={(e) => set((d) => { d.unit = e.target.value; return d; })} /></div>
          <div className="field"><label>Date</label>
            <input type="date" value={data.date} disabled={!canEdit} onChange={(e) => set((d) => { d.date = e.target.value; return d; })} /></div>
        </div>
      </div>

      <EvalFields data={data} set={set} canEdit={canEdit} />

      <div className="card es-card">
        <PhotoAttach photos={photos} ids={data.photo_ids} uploader={uploader} onOpen={onOpenPhotos} kind="other"
          label="Paper copy (photos of the filled-in sheet)"
          onChange={(ids) => set((d) => { d.photo_ids = ids; return d; })} />
        {!canEdit && data.photo_ids.length === 0 && <p className="hint">No photos of a paper copy.</p>}
      </div>

      {isOwner && canEdit && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="secondary danger" onClick={() => onDelete(sheet)}>Delete this sheet</button>
        </div>
      )}
      {printing && typeof document !== 'undefined' && createPortal(<PrintSheet data={data} />, document.body)}
    </div>
  );
}

// Eval sheets for a carpet job: one per unit, filled in on the phone or iPad (the digital form), with photos of a paper copy
// attached to the same sheet when one was filled in by hand. The total comes from the printed sheet's prices.
export default function EvalSheetTab({ jobId, job, staff, photos, uploader, onOpenPhotos, canEdit }) {
  const [sheets, setSheets] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [setup, setSetup] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().from('job_eval_sheets').select('*').eq('job_id', jobId).order('created_at');
    if (error) { if (missingTable(error)) setSetup(true); else setMsg({ err: true, text: error.message }); setSheets([]); return; }
    setSheets(data || []);
  }, [jobId]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setMsg(null);
    const prev = sheets?.[sheets.length - 1];
    // a new unit in the same complex starts with the complex and building already filled in
    const base = blankEval({
      complex: prev ? cleanEval(prev.data).complex : job?.customer?.display_name || '',
      building: prev ? cleanEval(prev.data).building : '',
      unit: prev ? '' : job?.address?.unit || '',
      date: todayInput(),
    });
    const { data, error } = await getSupabase().from('job_eval_sheets').insert({ job_id: jobId, data: base, created_by: staff.id }).select('*').single();
    if (error) { setMsg({ err: true, text: error.message.includes('row-level') ? 'Not allowed. The job may be closed.' : error.message }); return; }
    setSheets((s) => [...(s || []), data]);
    setOpenId(data.id);
  }

  async function remove(sheet) {
    if (!window.confirm(`Delete ${evalTitle(sheet.data)}? This cannot be undone.`)) return;
    const { error } = await getSupabase().from('job_eval_sheets').delete().eq('id', sheet.id);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setOpenId(null);
    load();
  }

  if (setup) return <div className="card"><h3>Eval sheets</h3><p className="hint">Eval sheets need migration 023 run once in the Supabase SQL Editor.</p></div>;
  if (!sheets) return <p className="muted">Loading eval sheets...</p>;

  const open = sheets.find((s) => s.id === openId);
  if (open) {
    return (
      <Editor key={open.id} sheet={open} canEdit={canEdit} photos={photos} uploader={uploader} onOpenPhotos={onOpenPhotos}
        isOwner={staff.role === 'owner'} onDelete={remove} onClose={() => { setOpenId(null); load(); }} />
    );
  }

  return (
    <div className="es-list">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Eval sheets</h3>
        {canEdit && <button type="button" className="primary" onClick={create}>New eval sheet</button>}
      </div>
      <p className="hint">One sheet per unit. Fill it in here, and attach photos of a paper copy if one was written by hand.</p>
      {msg && <div className={`banner ${msg.err ? 'flag' : 'ok'}`}>{msg.text}</div>}
      {sheets.length === 0 && <p className="muted">No eval sheets on this job yet.</p>}
      {sheets.map((s) => {
        const d = cleanEval(s.data);
        return (
          <button key={s.id} type="button" className="card es-row" onClick={() => setOpenId(s.id)}>
            <span className="es-row-main">
              <b>{evalTitle(d)}</b>
              <span className="muted">{[d.complex, d.date, d.replacement ? 'Replacement needed' : '', d.photo_ids.length ? `${d.photo_ids.length} paper photo${d.photo_ids.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || fmtDateTime(s.created_at)}</span>
            </span>
            <b>{fmtMoney(evalTotal(d))}</b>
          </button>
        );
      })}
      {sheets.length > 1 && <div className="es-total-row"><span>Total, {sheets.length} units</span><b>{fmtMoney(evalJobTotal(sheets))}</b></div>}
    </div>
  );
}
