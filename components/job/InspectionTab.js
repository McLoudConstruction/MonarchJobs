'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import SignaturePad from '@/components/SignaturePad';
import { fmtDateTime } from '@/lib/format';
import {
  KINDS, FIBERS, ISSUE_TYPES, PRETEST, RESULTS, NOT_REMOVED, blankRoom, blankIssue, cleanInspection, seedPostFromPre,
  roomsFromPlan, missingBeforeSigning, summarize, latestSigned,
} from '@/lib/inspection';

const SAVE_DELAY_MS = 900;

// Before and after cleaning record, room by room, signed by the customer on this phone. Pre: fiber, traffic,
// spot test and spots noted. Post: the same rooms with a result for every spot, drying time and a walk-through.
// A signed record can never change; a new one starts from the old.
function Panel({ kind, jobId, rows, sketches, pre, canEdit, onReload, staff }) {
  const signed = latestSigned(rows, kind);
  const draft = rows.filter((r) => r.kind === kind && !r.signed_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  const [data, setData] = useState(null);
  const [saveText, setSaveText] = useState('');
  const [name, setName] = useState('');
  const [sig, setSig] = useState(null);
  const [comments, setComments] = useState('');
  const [msg, setMsg] = useState(null);
  const timer = useRef(null);
  const draftId = draft?.id;

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
    if (!base.rooms.length) {
      const sk = sketches.find((s) => s.plan?.rooms?.length);
      if (sk) base.rooms = roomsFromPlan(sk.plan).map((r) => (kind === 'post' ? { ...r } : r));
    }
    const { error } = await getSupabase().from('job_inspections').insert({ job_id: jobId, kind, data: base, created_by: staff.id });
    if (error) { setMsg({ err: true, text: error.message.includes('row-level') ? 'Not allowed. The job may be closed.' : error.message }); return; }
    onReload();
  }

  async function discard() {
    if (!window.confirm('Discard this unsigned record?')) return;
    await getSupabase().from('job_inspections').delete().eq('id', draftId);
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
    setName(''); setSig(null);
    onReload();
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
          <p><strong>Signed by {signed.signer_name}</strong> on {fmtDateTime(signed.signed_at)}. {summarize(kind, signed.data).text}.</p>
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

      {draft && data && (
        <div>
          {data.rooms.map((r, i) => (
            <div key={r.id} className="card" style={{ margin: '10px 0', padding: 12 }}>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Room</label><input value={r.name} onChange={(e) => update((d) => { d.rooms[i].name = e.target.value; return d; })} /></div>
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
              <div className="field" style={{ marginTop: 8, marginBottom: 0 }}><label>Notes (optional)</label><input value={room(i).notes} maxLength={400} onChange={(e) => update((d) => { d.rooms[i].notes = e.target.value; return d; })} /></div>
            </div>
          ))}
          <div className="row">
            <button type="button" className="secondary small" onClick={() => update((d) => { d.rooms.push(blankRoom()); return d; })}>+ Add a room</button>
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

          <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <p className="hint">Hand the phone to the customer. Signing locks this record.</p>
            <div className="field"><label>Customer’s full name</label><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
            <div className="field"><label>Customer’s signature</label><SignaturePad onChange={setSig} /></div>
            <button className="primary big" style={{ width: '100%' }} onClick={sign}>Sign and lock</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InspectionTab({ jobId, staff, sketches = [], canEdit = true }) {
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
      <Panel kind="pre" jobId={jobId} rows={rows} sketches={plans.length ? plans : sketches} pre={pre} canEdit={canEdit} onReload={load} staff={staff} />
      <Panel kind="post" jobId={jobId} rows={rows} sketches={plans.length ? plans : sketches} pre={pre} canEdit={canEdit} onReload={load} staff={staff} />
    </>
  );
}
