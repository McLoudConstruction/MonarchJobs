'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSupabase } from '@/lib/supabaseClient';
import SignaturePad from '@/components/SignaturePad';
import PhotoAttach from '@/components/job/PhotoAttach';
import './inspection.css';
import { fmtDateTime } from '@/lib/format';
import {
  KINDS, FIBERS, ISSUE_TYPES, PRETEST, RESULTS, NOT_REMOVED, MAX_ROOM_COUNT, blankRoom, blankIssue, cleanInspection, seedPostFromPre,
  missingBeforeSigning, summarize, latestSigned,
} from '@/lib/inspection';

const SAVE_DELAY_MS = 900;

// Before and after cleaning record, signed by the customer on this phone. The simple record is how many rooms and photos;
// the tech can also call out specific rooms (Pre: fiber, traffic, spot test and spots noted. Post: the same rooms with a result
// for every spot), then add drying time and a walk-through. A signed record can never change; a new one starts from the old.
function Panel({ kind, jobId, rows, sketches, pre, canEdit, onReload, staff, photos, uploader, onOpenPhotos, launch }) {
  const signed = latestSigned(rows, kind);
  const draft = rows.filter((r) => r.kind === kind && !r.signed_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  const [data, setData] = useState(null);
  const [saveText, setSaveText] = useState('');
  const [name, setName] = useState('');
  const [sig, setSig] = useState(null);
  const [comments, setComments] = useState('');
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(false); // the record fills the screen while it is being filled in
  const [step, setStep] = useState('edit'); // 'edit' | 'sign': the signature is its own step, behind the Signature button
  const timer = useRef(null);
  const draftId = draft?.id;
  const lastLaunch = useRef(null);

  useEffect(() => {
    setData(draft ? cleanInspection(kind, draft.data) : null);
    setComments(draft ? cleanInspection(kind, draft.data).comments || '' : '');
    // only when a different draft is opened, not on every save
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, kind]);

  const persist = useCallback((next) => {
    clearTimeout(timer.current);
    setSaveText('Saving...');
    timer.current = setTimeout(async () => {
      const { error } = await getSupabase().from('job_inspections').update({ data: cleanInspection(kind, next) }).eq('id', draftId);
      setSaveText(error ? 'Could not save. Check your connection.' : 'Saved');
    }, SAVE_DELAY_MS);
  }, [draftId, kind]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (fn) => setData((d) => { const next = fn(structuredClone(d)); persist(next); return next; });

  async function start() {
    setMsg(null);
    let base;
    if (kind === 'post') {
      const preRec = latestSigned(rows, 'pre') || rows.find((r) => r.kind === 'pre');
      base = preRec ? seedPostFromPre(preRec.data) : cleanInspection('post', {});
    } else {
      base = cleanInspection('pre', {});
    }
    const { error } = await getSupabase().from('job_inspections').insert({ job_id: jobId, kind, data: base, created_by: staff.id });
    if (error) { setMsg({ err: true, text: error.message.includes('row-level') ? 'Not allowed. The job may be closed.' : error.message }); return; }
    setStep('edit');
    setOpen(true);
    onReload();
  }

  // The tech view opens this record by itself: the before record on Start, the after record on Finish.
  useEffect(() => {
    if (!launch || lastLaunch.current === launch) return;
    lastLaunch.current = launch;
    if (!canEdit) return;
    if (draft) { setStep('edit'); setOpen(true); } else if (!signed && (kind === 'pre' || pre)) start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch]);

  async function discard() {
    if (!window.confirm('Discard this unsigned record?')) return;
    await getSupabase().from('job_inspections').delete().eq('id', draftId);
    setOpen(false);
    onReload();
  }

  async function sign() {
    setMsg(null);
    const full = { ...data, ...(kind === 'post' ? { comments } : {}) };
    const missing = missingBeforeSigning(kind, full);
    if (missing.length) { setMsg({ err: true, text: missing[0] }); return; }
    if (name.trim().length < 2) { setMsg({ err: true, text: 'Type the customer’s full name.' }); return; }
    if (!sig) { setMsg({ err: true, text: 'The customer needs to sign in the box.' }); return; }
    clearTimeout(timer.current);
    const sb = getSupabase();
    const { error } = await sb.from('job_inspections').update({ data: cleanInspection(kind, full), signer_name: name.trim(), signature_png: sig }).eq('id', draftId);
    if (error) { setMsg({ err: true, text: error.message.includes('INSPECTION_SIGNED') ? 'This record was already signed.' : error.message }); return; }
    await sb.from('job_events').insert({ job_id: jobId, actor_id: staff.id, actor_email: staff.email, kind: 'inspection_signed', details: { kind, signer_name: name.trim() } });
    setName(''); setSig(null); setOpen(false); setStep('edit');
    onReload();
  }

  // The customer is not there: lock the record with no signature. The walk-through is not recorded as done.
  async function markAbsent() {
    setMsg(null);
    const full = { ...data, ...(kind === 'post' ? { comments, walkthrough: false } : {}) };
    const missing = missingBeforeSigning(kind, full, { absent: true });
    if (missing.length) { setMsg({ err: true, text: missing[0] }); return; }
    if (!window.confirm('Customer not present? This locks the record without a signature.')) return;
    clearTimeout(timer.current);
    const sb = getSupabase();
    const { error } = await sb.from('job_inspections').update({ data: cleanInspection(kind, full), customer_absent: true }).eq('id', draftId);
    if (error) { setMsg({ err: true, text: error.message.includes('INSPECTION_SIGNED') ? 'This record was already locked.' : error.message.includes('customer_absent') ? 'This needs database update 022. Ask the owner to run it.' : error.message }); return; }
    await sb.from('job_events').insert({ job_id: jobId, actor_id: staff.id, actor_email: staff.email, kind: 'inspection_signed', details: { kind, absent: true } });
    setName(''); setSig(null); setOpen(false); setStep('edit');
    onReload();
  }

  function goSign() {
    setMsg(null);
    const full = { ...data, ...(kind === 'post' ? { comments } : {}) };
    const missing = missingBeforeSigning(kind, full);
    if (missing.length) { setMsg({ err: true, text: missing[0] }); return; }
    setStep('sign');
  }

  const room = (i) => data.rooms[i];
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{KINDS[kind]}</h2>
        {draft && <span className="muted">{saveText}</span>}
      </div>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}

      {signed && !draft && (
        <div>
          <p>{signed.customer_absent ? <strong>Customer not present, no signature</strong> : <strong>Signed by {signed.signer_name}</strong>} on {fmtDateTime(signed.signed_at)}. {summarize(kind, signed.data).text}.</p>
          {signed.signature_png && <img src={signed.signature_png} alt={`Signature of ${signed.signer_name}`} style={{ maxWidth: 240, maxHeight: 80, border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }} />}
          {cleanInspection(kind, signed.data).rooms.map((r) => (
            <div key={r.id} style={{ marginTop: 8 }}>
              <strong>{r.name}</strong> <span className="muted">{[r.fiber, r.traffic ? 'high traffic' : '', kind === 'pre' && r.pretest !== 'not_tested' ? PRETEST[r.pretest] : ''].filter(Boolean).join(' · ')}</span>
              {r.issues.map((s) => <div key={s.id} style={{ paddingLeft: 12 }}>{s.type}{s.where ? `, ${s.where}` : ''}{s.result ? `: ${RESULTS[s.result]}` : ''}</div>)}
            </div>
          ))}
          {canEdit && <button className="secondary small" style={{ marginTop: 10 }} onClick={start}>Start a new one</button>}
        </div>
      )}

      {!signed && !draft && (
        canEdit
          ? <button className="primary" onClick={start} disabled={kind === 'post' && !pre}>{kind === 'post' && !pre ? 'Do the before record first' : 'Start'}</button>
          : <p className="muted">Nothing recorded.</p>
      )}

      {draft && data && !open && (
        <div>
          <p className="hint">{summarize(kind, data).text}. Not signed yet.</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => { setStep('edit'); setOpen(true); }}>Continue</button>
            <button type="button" className="secondary small" onClick={discard}>Discard</button>
          </div>
        </div>
      )}

      {draft && data && open && typeof document !== 'undefined' && createPortal(
        <div className="insp-full" role="dialog" aria-modal="true" aria-label={KINDS[kind]}>
          <header className="insp-bar">
            <strong>{KINDS[kind]}</strong>
            <span className="muted">{saveText}</span>
            <button type="button" className="secondary small" style={{ marginLeft: 'auto' }} onClick={() => (step === 'sign' ? setStep('edit') : setOpen(false))}>{step === 'sign' ? 'Back' : 'Close'}</button>
          </header>
          <div className="insp-body">
            {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
            {step === 'edit' ? (
              <>
          <div className="card" style={{ margin: '10px 0', padding: 14 }}>
            <div className="field" style={{ marginBottom: 12 }}>
              <label htmlFor="insp-rooms">How many rooms?</label>
              <div className="insp-stepper">
                <button type="button" className="secondary big" aria-label="One fewer room" disabled={(data.room_count || 0) <= data.rooms.length}
                  onClick={() => update((d) => { d.room_count = Math.max(d.rooms.length, (d.room_count || 0) - 1); return d; })}>&minus;</button>
                <input id="insp-rooms" type="number" inputMode="numeric" min="0" max={MAX_ROOM_COUNT} placeholder="0" value={data.room_count || ''}
                  onChange={(e) => update((d) => { const n = Math.round(Number(e.target.value)); d.room_count = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_ROOM_COUNT) : 0; return d; })}
                  onBlur={() => update((d) => { d.room_count = Math.max(d.room_count || 0, d.rooms.length); return d; })} />
                <button type="button" className="secondary big" aria-label="One more room"
                  onClick={() => update((d) => { d.room_count = Math.min(MAX_ROOM_COUNT, (d.room_count || 0) + 1); return d; })}>+</button>
              </div>
            </div>
            <PhotoAttach over photos={photos || []} ids={data.photo_ids || []} uploader={uploader} onOpen={onOpenPhotos} kind={kind === 'pre' ? 'before' : 'after'}
              label={kind === 'pre' ? 'Photos before cleaning' : 'Photos after cleaning'}
              onChange={(ids) => update((d) => { d.photo_ids = ids; return d; })} />
            <div className="field" style={{ marginTop: 8, marginBottom: 0 }}><label htmlFor="insp-notes">Notes (optional)</label>
              <input id="insp-notes" value={data.notes || ''} maxLength={800} onChange={(e) => update((d) => { d.notes = e.target.value; return d; })} />
            </div>
          </div>
          <h3 style={{ margin: '16px 0 2px' }}>Rooms to call out <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></h3>
          <p className="hint" style={{ marginTop: 0 }}>Add a room only if something needs noting there: a stain, a different fiber, a spot test, or photos of just that room.</p>
          {data.rooms.map((r, i) => (
            <div key={r.id} className="card" style={{ margin: '10px 0', padding: 12 }}>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Room name</label><input value={r.name} onChange={(e) => update((d) => { d.rooms[i].name = e.target.value; return d; })} /></div>
                <button type="button" className="danger small" onClick={() => update((d) => { d.rooms.splice(i, 1); return d; })}>Remove</button>
              </div>
              {kind === 'pre' && (
                <div className="grid2" style={{ marginTop: 8 }}>
                  <div className="field"><label>Fiber</label>
                    <select value={r.fiber} onChange={(e) => update((d) => { d.rooms[i].fiber = e.target.value; return d; })}>
                      <option value="">Not recorded</option>
                      {FIBERS.map((f) => <option key={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Spot test</label>
                    <select value={r.pretest} onChange={(e) => update((d) => { d.rooms[i].pretest = e.target.value; return d; })}>
                      {Object.entries(PRETEST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {kind === 'pre' && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input type="checkbox" checked={r.traffic} onChange={(e) => update((d) => { d.rooms[i].traffic = e.target.checked; return d; })} /> High-traffic wear
                </label>
              )}
              {r.issues.map((s, j) => (
                <div key={s.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
                  <div className="row" style={{ alignItems: 'flex-end' }}>
                    <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Spot or issue</label>
                      <select value={s.type} onChange={(e) => update((d) => { d.rooms[i].issues[j].type = e.target.value; return d; })} disabled={kind === 'post'}>
                        {ISSUE_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Where</label><input value={s.where} disabled={kind === 'post'} onChange={(e) => update((d) => { d.rooms[i].issues[j].where = e.target.value; return d; })} placeholder="By the window" /></div>
                    {kind === 'pre' && <button type="button" className="secondary small" onClick={() => update((d) => { d.rooms[i].issues.splice(j, 1); return d; })}>X</button>}
                  </div>
                  {kind === 'post' && (
                    <div className="row" style={{ marginTop: 6, alignItems: 'flex-end' }}>
                      <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Result</label>
                        <select value={s.result || ''} onChange={(e) => update((d) => { d.rooms[i].issues[j].result = e.target.value; return d; })}>
                          <option value="">Choose...</option>
                          {Object.entries(RESULTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </div>
                      <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Note</label><input value={s.note || ''} maxLength={200} onChange={(e) => update((d) => { d.rooms[i].issues[j].note = e.target.value; return d; })} /></div>
                    </div>
                  )}
                  {kind === 'post' && NOT_REMOVED.includes(s.result) && <p className="hint" style={{ margin: '4px 0 0' }}>The customer will see this listed as not removed.</p>}
                </div>
              ))}
              {kind === 'pre' && <button type="button" className="secondary small" style={{ marginTop: 8 }} onClick={() => update((d) => { d.rooms[i].issues.push(blankIssue()); return d; })}>+ Add a spot or issue</button>}
              <PhotoAttach over photos={photos || []} ids={r.photo_ids || []} uploader={uploader} onOpen={onOpenPhotos} kind={kind === 'pre' ? 'before' : 'after'} label={`Photos of ${r.name || 'this room'}`}
                onChange={(ids) => update((d) => { d.rooms[i].photo_ids = ids; return d; })} />
              <div className="field" style={{ marginTop: 8, marginBottom: 0 }}><label>Notes (optional)</label><input value={room(i).notes} maxLength={400} onChange={(e) => update((d) => { d.rooms[i].notes = e.target.value; return d; })} /></div>
            </div>
          ))}
                <div className="row">
                  <button type="button" className="secondary small" onClick={() => update((d) => { d.rooms.push(blankRoom()); d.room_count = Math.max(d.room_count || 0, d.rooms.length); return d; })}>+ Call out a room</button>
                  <button type="button" className="secondary small" onClick={discard}>Discard</button>
                </div>
          {kind === 'post' && (
            <div style={{ marginTop: 12 }}>
              <div className="field" style={{ maxWidth: 240 }}><label>Dries in about (hours)</label>
                <input type="number" min="1" max="72" value={data.drying_hours ?? ''} onChange={(e) => update((d) => { d.drying_hours = e.target.value === '' ? null : Number(e.target.value); return d; })} />
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <input type="checkbox" checked={data.walkthrough} onChange={(e) => update((d) => { d.walkthrough = e.target.checked; return d; })} /> I walked through the work with the customer
              </label>
              <div className="field"><label>Customer comments (optional)</label><input value={comments} maxLength={600} onChange={(e) => setComments(e.target.value)} /></div>
            </div>
          )}

              </>
            ) : (
              <div style={{ maxWidth: 520, margin: '0 auto' }}>
                <p className="hint">Hand the phone to the customer. Signing locks this record.</p>
                <div className="field"><label>Customer’s full name</label><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
                <div className="field"><label>Customer’s signature</label><SignaturePad onChange={setSig} /></div>
                <button className="primary big" style={{ width: '100%' }} onClick={sign}>Sign and lock</button>
                <button type="button" className="secondary big" style={{ width: '100%', marginTop: 10 }} onClick={markAbsent}>Customer not present</button>
              </div>
            )}
          </div>
          {step === 'edit' && (
            <footer className="insp-foot">
              <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                <button type="button" className="secondary big" style={{ flex: 1 }} onClick={markAbsent}>Customer not present</button>
                <button type="button" className="primary big" style={{ flex: 1 }} onClick={goSign}>Signature</button>
              </div>
            </footer>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function InspectionTab({ jobId, staff, sketches = [], canEdit = true, photos = [], uploader = null, onOpenPhotos = null, launch = null }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [plans, setPlans] = useState([]);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [{ data, error }, { data: sk }] = await Promise.all([
      sb.from('job_inspections').select('*').eq('job_id', jobId).order('created_at', { ascending: false }),
      sb.from('job_sketches').select('id,name,plan').eq('job_id', jobId).order('sort_order'),
    ]);
    if (error) { setErr(error.code === '42P01' || /does not exist|schema cache/i.test(error.message) ? 'This needs database update 015. Ask the owner to run it.' : error.message); return; }
    setRows(data || []);
    setPlans(sk || []);
  }, [jobId]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="card"><p className="muted">{err}</p></div>;
  if (!rows) return <div className="card"><p className="muted">Loading...</p></div>;
  const pre = latestSigned(rows, 'pre') || rows.find((r) => r.kind === 'pre') || null;
  return (
    <>
      <p className="hint">Walk the rooms with the customer before you start, and again when you finish. The customer signs on this phone. They can see the signed records on their care page.</p>
      <Panel kind="pre" jobId={jobId} rows={rows} sketches={plans.length ? plans : sketches} pre={pre} canEdit={canEdit} onReload={load} staff={staff} photos={photos} uploader={uploader} onOpenPhotos={onOpenPhotos} launch={launch?.kind === 'pre' ? launch.n : null} />
      <Panel kind="post" jobId={jobId} rows={rows} sketches={plans.length ? plans : sketches} pre={pre} canEdit={canEdit} onReload={load} staff={staff} photos={photos} uploader={uploader} onOpenPhotos={onOpenPhotos} launch={launch?.kind === 'post' ? launch.n : null} />
    </>
  );
}
