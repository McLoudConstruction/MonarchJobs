'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { PHOTO_KINDS, PHOTO_KIND_KEYS, countByKind } from '@/lib/jobDocs';
import { normalizePlan } from '@/lib/sketch';
import { moistureLogCsv, moistureSummaryCsv } from '@/lib/moistureLog';
import { equipmentLogCsv } from '@/lib/equipmentLog';
import { buildMoistureReportPdf } from '@/lib/reportExport';
import { MAX_REPORT_PHOTOS, photoSections, beforeAfterPairs, renderPhotoReport } from '@/lib/photoReport';
import { fetchReportPhotos, downloadBytes, safeName } from '@/lib/photoReportClient';
import { reportGroups, sketchContents, defaultSketch, dryingReady, DRYING_REPORTS, reportFileName } from '@/lib/reports';
import AdjusterLink from '@/components/job/AdjusterLink';
import './reports.css';

// Reports tab: the documents a job can hand out, made on the spot from what the job holds right now (nothing is stored,
// so a report is never out of date). Photos (every kind of job): the photo report and before & after. Drying (jobs that
// have the Moisture tab): the customer report, summary, equipment report, carrier packet and spreadsheets.
// None of them names staff. info = { business, phone, email, customer, address, jobNumber, jobType }.
export default function ReportsTab({ jobId, service, photos, rooms, sketches: pageSketches, info, isOffice }) {
  const [biz, setBiz] = useState(null);
  const [fresh, setFresh] = useState(null); // sketches read just now (the Moisture tab saves on its own, so the page's copy can be old)
  const [sketchId, setSketchId] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null); // { ok, text }
  const [linkOpen, setLinkOpen] = useState(false);
  // photo report options
  const [kinds, setKinds] = useState([]);
  const [room, setRoom] = useState('');
  const [groupBy, setGroupBy] = useState('kind');
  const [captions, setCaptions] = useState(true);
  const [dates, setDates] = useState(true);
  const [baRoom, setBaRoom] = useState('');

  useEffect(() => {
    let live = true;
    const sb = getSupabase();
    sb.from('settings').select('business_name,phone,email').eq('id', 1).maybeSingle().then(({ data }) => {
      if (live && data) setBiz({ business: data.business_name || '', phone: data.phone || '', email: data.email || '' });
    });
    sb.from('job_sketches').select('id,name,plan').eq('job_id', jobId).order('sort_order').order('created_at').then(({ data, error }) => {
      if (live && !error && data) setFresh(data);
    });
    return () => { live = false; };
  }, [jobId]);

  const sketches = fresh || pageSketches || [];
  const contents = useMemo(() => sketchContents(sketches), [sketches]);
  useEffect(() => { if (!sketchId || !contents.some((c) => c.id === sketchId)) setSketchId(defaultSketch(contents)); }, [contents, sketchId]);
  const groups = useMemo(() => reportGroups({ service, sketches, photos, rooms }), [service, sketches, photos, rooms]);
  const header = { ...info, ...(biz || {}) };
  const counts = useMemo(() => countByKind(photos), [photos]);
  const roomsWithPhotos = useMemo(() => {
    const has = new Set((photos || []).filter((p) => !p.archived_at && p.sketch_id && p.room_key).map((p) => `${p.sketch_id}|${p.room_key}`));
    return rooms.filter((r) => has.has(r.value));
  }, [photos, rooms]);

  const chosenSketch = sketches.find((s) => s.id === sketchId) || null;
  const chosenContents = contents.find((c) => c.id === sketchId) || null;
  const title = [info.address, info.customer].filter(Boolean).join(' · ') || `Job ${info.jobNumber || ''}`;
  const toggleKind = (k) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  async function run(key, fn) {
    if (busy) return;
    setBusy(key); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: e?.message || 'That report could not be made.' }); }
    setBusy('');
  }

  const makePhotoPdf = (mode) => run(mode, async () => {
    const sections = mode === 'photos' ? photoSections(photos, { kinds, room, groupBy }, rooms) : [];
    const pairs = mode === 'beforeafter' ? beforeAfterPairs(photos, rooms, { room: baRoom }) : [];
    const picked = mode === 'photos' ? sections.flatMap((s) => s.photos) : pairs.flatMap((p) => [p.before, p.after]);
    if (!picked.length) throw new Error('No photos match those choices.');
    if (picked.length > MAX_REPORT_PHOTOS) throw new Error(`That is ${picked.length} photos. A report holds up to ${MAX_REPORT_PHOTOS}: narrow it by folder or room and make more than one.`);
    const roomNames = new Map(rooms.map((r) => [r.value, r.label]));
    const { images, failed } = await fetchReportPhotos(picked, (done, total) => setBusy(`${mode}:${done}/${total}`));
    if (failed.length === picked.length) throw new Error('None of the photos could be loaded. Check the connection and try again.');
    const item = (p) => {
      const im = images.get(p.id);
      if (!im) return null;
      const rv = p.sketch_id && p.room_key ? `${p.sketch_id}|${p.room_key}` : '';
      return { ...im, caption: p.caption || '', takenAt: p.taken_at, label: mode === 'photos' ? (groupBy === 'kind' ? roomNames.get(rv) || '' : PHOTO_KINDS[p.kind] || '') : '' };
    };
    const outSections = sections.map((s) => ({ heading: s.heading, photos: s.photos.map(item).filter(Boolean) })).filter((s) => s.photos.length);
    const outPairs = pairs.map((p) => ({ roomName: p.roomName, before: item(p.before), after: item(p.after) })).filter((p) => p.before && p.after);
    const pdf = renderPhotoReport({ mode, title, info: header, sections: outSections, pairs: outPairs, showCaptions: captions, showDates: dates, preparedAt: new Date() });
    downloadBytes(pdf, reportFileName(info.jobNumber, mode === 'photos' ? 'photos' : 'before-after', 'pdf'));
    setMsg({ ok: true, text: failed.length ? `Report made. ${failed.length} photo${failed.length === 1 ? '' : 's'} could not be loaded and ${failed.length === 1 ? 'was' : 'were'} left out.` : 'Report made.' });
  });

  const makeDrying = (r) => run(r.key, async () => {
    if (!chosenSketch) throw new Error('There is no sketch to report on yet.');
    const plan = normalizePlan(chosenSketch.plan);
    if (r.format === 'pdf') {
      const pdf = await buildMoistureReportPdf(plan, { variant: r.variant, title: info.address || info.customer || 'Job', info: header });
      downloadBytes(pdf, reportFileName(info.jobNumber, r.variant === 'full' ? 'moisture-report' : `moisture-${r.variant}`, 'pdf'));
    } else {
      const text = r.variant === 'log' ? moistureLogCsv(plan) : r.variant === 'summary-csv' ? moistureSummaryCsv(plan) : equipmentLogCsv(plan);
      const name = r.variant === 'log' ? 'moisture-log' : r.variant === 'summary-csv' ? 'moisture-summary' : 'equipment-log';
      downloadBytes(new TextEncoder().encode(text), reportFileName(info.jobNumber, name, 'csv'), 'text/csv;charset=utf-8');
    }
    setMsg({ ok: true, text: 'Report made.' });
  });

  const progress = (mode) => (busy.startsWith(`${mode}:`) ? ` (${busy.split(':')[1]})` : '');

  return (
    <>
      <div className="card">
        <h2>Reports</h2>
        <p className="hint">Made fresh from this job each time you tap, so they are always up to date. They show the company, never a staff member. Nothing is sent from here: download the file to print, email or upload it.</p>
        {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.text}</div>}
      </div>

      {groups.map((g) => (
        <div className="card" key={g.key}>
          <h3>{g.title}</h3>

          {g.key === 'photos' && (
            <>
              <div className="rep-item">
                <div className="rep-head">
                  <div>
                    <div className="rep-title">Photo report</div>
                    <div className="hint" style={{ margin: 0 }}>{g.items[0].text}</div>
                  </div>
                  <button type="button" className="primary" disabled={!g.items[0].ready || !!busy} onClick={() => makePhotoPdf('photos')}>
                    {busy.startsWith('photos') ? `Making…${progress('photos')}` : 'Download PDF'}
                  </button>
                </div>
                {!g.items[0].ready ? <p className="hint">{g.items[0].hint}</p> : (
                  <div className="rep-opts">
                    <div className="field">
                      <label>Folders (none picked means all)</label>
                      <div className="chips" role="group" aria-label="Photo folders to include">
                        {PHOTO_KIND_KEYS.filter((k) => counts[k] > 0).map((k) => (
                          <button key={k} type="button" className={kinds.includes(k) ? 'on' : ''} aria-pressed={kinds.includes(k)} onClick={() => toggleKind(k)}>{PHOTO_KINDS[k]}<span className="chip-n">{counts[k]}</span></button>
                        ))}
                      </div>
                    </div>
                    <div className="grid2">
                      <div className="field">
                        <label htmlFor="rep-group">Group by</label>
                        <select id="rep-group" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                          <option value="kind">Folder (Before, During, After…)</option>
                          <option value="room">Room</option>
                        </select>
                      </div>
                      {roomsWithPhotos.length > 0 && (
                        <div className="field">
                          <label htmlFor="rep-room">Only this room</label>
                          <select id="rep-room" value={room} onChange={(e) => setRoom(e.target.value)}>
                            <option value="">All rooms</option>
                            {roomsWithPhotos.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                    <label className="check"><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Print captions <span className="muted">(they are written for staff, so read them first)</span></label>
                    <label className="check"><input type="checkbox" checked={dates} onChange={(e) => setDates(e.target.checked)} /> Print the date each photo was taken</label>
                  </div>
                )}
              </div>

              <div className="rep-item">
                <div className="rep-head">
                  <div>
                    <div className="rep-title">Before &amp; after</div>
                    <div className="hint" style={{ margin: 0 }}>{g.items[1].text}</div>
                  </div>
                  <button type="button" className="primary" disabled={!g.items[1].ready || !!busy} onClick={() => makePhotoPdf('beforeafter')}>
                    {busy.startsWith('beforeafter') ? `Making…${progress('beforeafter')}` : 'Download PDF'}
                  </button>
                </div>
                {!g.items[1].ready ? <p className="hint">{g.items[1].hint}</p> : (
                  roomsWithPhotos.length > 1 && (
                    <div className="rep-opts">
                      <div className="field">
                        <label htmlFor="rep-ba-room">Only this room</label>
                        <select id="rep-ba-room" value={baRoom} onChange={(e) => setBaRoom(e.target.value)}>
                          <option value="">All rooms</option>
                          {roomsWithPhotos.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </div>
                    </div>
                  )
                )}
              </div>
            </>
          )}

          {g.key === 'drying' && (
            <>
              {contents.length > 1 && (
                <div className="field" style={{ maxWidth: 320 }}>
                  <label htmlFor="rep-sketch">Sketch</label>
                  <select id="rep-sketch" value={sketchId || ''} onChange={(e) => setSketchId(e.target.value)}>
                    {contents.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.readings} reading{c.readings === 1 ? '' : 's'})</option>)}
                  </select>
                </div>
              )}
              {g.items.map((it) => {
                const ready = dryingReady(DRYING_REPORTS.find((d) => d.key === it.key), chosenContents);
                const def = DRYING_REPORTS.find((d) => d.key === it.key);
                return (
                  <div className="rep-item" key={it.key}>
                    <div className="rep-head">
                      <div>
                        <div className="rep-title">{it.title}</div>
                        <div className="hint" style={{ margin: 0 }}>{ready ? it.text : it.hint}</div>
                      </div>
                      <button type="button" className={it.format === 'pdf' ? 'primary' : 'secondary'} disabled={!ready || !!busy} onClick={() => makeDrying(def)}>
                        {busy === it.key ? 'Making…' : it.format === 'pdf' ? 'Download PDF' : 'Download CSV'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {isOffice && (
                <div className="rep-item">
                  <div className="rep-head">
                    <div>
                      <div className="rep-title">Adjuster link</div>
                      <div className="hint" style={{ margin: 0 }}>A read-only web page of the drying report for the insurance adjuster. You choose who gets it, it expires in 90 days and you can turn it off.</div>
                    </div>
                    <button type="button" className="secondary" onClick={() => setLinkOpen(true)}>Manage links</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ))}
      {linkOpen && <AdjusterLink jobId={jobId} onClose={() => setLinkOpen(false)} />}
    </>
  );
}
