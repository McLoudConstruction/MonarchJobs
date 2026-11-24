'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { PHOTO_KINDS } from '@/lib/jobDocs';
import { normalizePlan } from '@/lib/sketch';
import { withJobStandards } from '@/lib/moisture';
import { flattenFloors } from '@/lib/floors';
import { moistureLogCsv, moistureSummaryCsv } from '@/lib/moistureLog';
import { equipmentLogCsv } from '@/lib/equipmentLog';
import { buildMoistureReportPdf } from '@/lib/reportExport';
import { MAX_REPORT_PHOTOS, photoSections, beforeAfterPairs, renderPhotoReport } from '@/lib/photoReport';
import { fetchReportPhotos, downloadBytes, safeName } from '@/lib/photoReportClient';
import { reportGroups, sketchContents, defaultSketch, dryingReady, DRYING_REPORTS, reportFileName } from '@/lib/reports';
import { buildJobPacket } from '@/lib/jobPacketClient';
import { packetFileName } from '@/lib/jobPacket';
import { dailyBurn } from '@/lib/dailyBurn';
import { packetCheck } from '@/lib/packetCheck';
import { renderDailyBurn, dailyBurnFileName } from '@/lib/dailyBurnReport';
import { logoAsJpeg } from '@/lib/logoJpeg';
import { logoUrl } from '@/lib/branding';
import AdjusterLink from '@/components/job/AdjusterLink';
import './reports.css';

// One report. `note` is the result of the last tap on THIS row ({ ok, text }): shown right under the row, where the person is
// looking, instead of at the top of the card (out of sight after scrolling, and shifting every button down when it appeared).
function Row({ title, text, ready = true, hint, children, button, note = null }) {
  const noteRef = useRef(null);
  useEffect(() => { if (note) noteRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [note]);
  return (
    <div className="rep-item">
      <div className="rep-head">
        <div>
          <div className="rep-title">{title}</div>
          <div className="hint" style={{ margin: 0 }}>{ready ? text : hint}</div>
        </div>
        {children}
        {button}
      </div>
      {note && <div ref={noteRef} className={`msg ${note.ok ? 'ok' : 'err'}`} role="status" style={{ margin: '10px 0 0' }}>{note.text}</div>}
    </div>
  );
}

// Reports tab: the documents a job can hand out, made on the spot from what the job holds right now (nothing is stored,
// so a report is never out of date). Photos (every kind of job): the photo report and before & after. Drying (jobs that
// have the Moisture tab): the customer report, summary, equipment report, carrier packet and spreadsheets.
// None of them names staff. info = { business, phone, email, customer, address, jobNumber, jobType }.
export default function ReportsTab({ jobId, service, photos, rooms, sketches: pageSketches, info, isOffice, isOwner = false, jobStandards = null }) {
  const [biz, setBiz] = useState(null);
  const [steps, setSteps] = useState([]); // Day 1 steps and the certificate (water losses); stays empty if migration 051 is not run
  const [fresh, setFresh] = useState(null); // sketches read just now (the Moisture tab saves on its own, so the page's copy can be old)
  const [sketchId, setSketchId] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null); // { ok, text }
  const [msgKey, setMsgKey] = useState(''); // the report row the message belongs to
  const noteFor = (k) => (msgKey === k ? msg : null);
  const [linkOpen, setLinkOpen] = useState(false);
  // the one photo report option that is left: how the pictures are grouped
  const [groupBy, setGroupBy] = useState('kind');

  useEffect(() => {
    let live = true;
    const sb = getSupabase();
    sb.from('settings').select('business_name,phone,email,logo_path').eq('id', 1).maybeSingle().then(async ({ data }) => {
      if (!live || !data) return;
      setBiz({ business: data.business_name || '', phone: data.phone || '', email: data.email || '' });
      const logo = await logoAsJpeg(logoUrl(data.logo_path)); // every report carries the company logo
      if (live && logo) setBiz((b) => ({ ...(b || {}), logo }));
    });
    sb.from('job_sketches').select('id,name,plan').eq('job_id', jobId).order('sort_order').order('created_at').then(({ data, error }) => {
      if (live && !error && data) setFresh(data);
    });
    sb.from('job_water_steps').select('kind,customer_absent,created_at,data').eq('job_id', jobId).then(({ data, error }) => { if (live && !error && data) setSteps(data); });
    return () => { live = false; };
  }, [jobId]);

  const sketches = fresh || pageSketches || [];
  const contents = useMemo(() => sketchContents(sketches), [sketches]);
  useEffect(() => { if (!sketchId || !contents.some((c) => c.id === sketchId)) setSketchId(defaultSketch(contents)); }, [contents, sketchId]);
  const groups = useMemo(() => reportGroups({ service, sketches, photos, rooms }), [service, sketches, photos, rooms]);
  const header = { ...info, ...(biz || {}) };

  const chosenSketch = sketches.find((s) => s.id === sketchId) || null;
  const chosenContents = contents.find((c) => c.id === sketchId) || null;
  const title = [info.address, info.customer].filter(Boolean).join(' · ') || `Job ${info.jobNumber || ''}`;

  async function run(key, fn) {
    if (busy) return;
    setBusy(key); setMsg(null); setMsgKey(key);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: e?.message || 'That report could not be made.' }); }
    setBusy('');
  }

  const makePhotoPdf = (mode) => run(mode, async () => {
    const sections = mode === 'photos' ? photoSections(photos, { kinds: [], room: '', groupBy }, rooms) : [];
    const pairs = mode === 'beforeafter' ? beforeAfterPairs(photos, rooms) : [];
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
    const pdf = renderPhotoReport({ mode, title, info: header, sections: outSections, pairs: outPairs, showCaptions: false, showDates: true, preparedAt: new Date() });
    downloadBytes(pdf, reportFileName(info.jobNumber, mode === 'photos' ? 'photos' : 'before-after', 'pdf'));
    setMsg({ ok: true, text: failed.length ? `Report made. ${failed.length} photo${failed.length === 1 ? '' : 's'} could not be loaded and ${failed.length === 1 ? 'was' : 'were'} left out.` : 'Report made.' });
  });

  const makeDrying = (r) => run(r.key, async () => {
    if (!chosenSketch) throw new Error('There is no sketch to report on yet.');
    const plan = flattenFloors(withJobStandards(normalizePlan(chosenSketch.plan), jobStandards)); // the job's dry standards, so every sketch reports against the same ones
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

  const makePacket = () => run('packet', async () => {
    const pdf = await buildJobPacket(jobId, header);
    downloadBytes(pdf, packetFileName(info.jobNumber));
    setMsg({ ok: true, text: 'Packet made.' });
  });

  // Daily burn: the owner's own cost per calendar day (equipment on site x its daily cost, plus logged hours). Read fresh each time.
  const makeBurn = () => run('burn', async () => {
    const sb = getSupabase();
    const [sk, rt, tm] = await Promise.all([
      sb.from('job_sketches').select('id,name,plan').eq('job_id', jobId),
      sb.from('equipment_daily_rates').select('type,daily_cents'),
      sb.from('job_time_entries').select('worked_on,hours,rate_cents,voided_at').eq('job_id', jobId),
    ]);
    if (sk.error || rt.error || tm.error) throw new Error('Run the latest database update first (migration 021).');
    const rates = Object.fromEntries((rt.data || []).map((r) => [r.type, r.daily_cents]));
    const burn = dailyBurn(sk.data || [], rates, tm.data || []);
    if (burn.empty) throw new Error('Place equipment on the Moisture tab or log hours on the Costs tab first.');
    downloadBytes(renderDailyBurn({ info: header, burn, preparedAt: new Date() }), dailyBurnFileName(info.jobNumber));
    setMsg({ ok: true, text: 'Daily burn made.' });
  });

  const progress = (mode) => (busy.startsWith(`${mode}:`) ? ` (${busy.split(':')[1]})` : '');

  const photoItem = groups.find((g) => g.key === 'photos')?.items || [];
  const drying = groups.find((g) => g.key === 'drying');
  // is the carrier packet ready? advice only, for water losses
  const check = useMemo(() => (drying && isOffice ? packetCheck({ steps, photos, plans: sketches.map((s) => withJobStandards(normalizePlan(s.plan), jobStandards)) }) : null), [steps, photos, sketches, jobStandards, isOffice]); // eslint-disable-line react-hooks/exhaustive-deps
  const pdfBtn = (key, onClick, ready = true, label = 'Download PDF', cls = 'primary') => (
    <button type="button" className={cls} disabled={!ready} aria-busy={busy.startsWith(key)} onClick={onClick}>{busy.startsWith(key) ? `Making…${progress(key)}` : label}</button>
  );

  return (
    <div className="card">
      <h2>Reports</h2>

      {isOffice && <Row title="Full job packet" note={noteFor('packet')} text="Invoices with payments, the signed estimate and the signed inspections, in one PDF." button={pdfBtn('packet', makePacket)} />}

      {photoItem[0] && (
        <Row title="Photo report" note={noteFor('photos')} text={photoItem[0].text} ready={photoItem[0].ready} hint={photoItem[0].hint}
          button={pdfBtn('photos', () => makePhotoPdf('photos'), photoItem[0].ready)}>
          {photoItem[0].ready && (
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="rep-group" className="hint" style={{ margin: 0 }}>Group by</label>
              <select id="rep-group" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="kind">Folder (Before, During, After…)</option>
                <option value="room">Room</option>
              </select>
            </div>
          )}
        </Row>
      )}
      {photoItem[1] && <Row title="Before & after" note={noteFor('beforeafter')} text={photoItem[1].text} ready={photoItem[1].ready} hint={photoItem[1].hint} button={pdfBtn('beforeafter', () => makePhotoPdf('beforeafter'), photoItem[1].ready)} />}

      {drying && check && (
        <div className="rep-item" style={{ marginTop: 12 }}>
          <div className="rep-title">Packet check</div>
          <div className="hint" style={{ margin: '0 0 8px' }}>{check.gaps === 0 ? 'Everything the carrier packet needs is in.' : `${check.total - check.gaps} of ${check.total} ready. Nothing is blocked; these are the gaps to fix or explain.`}</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {check.items.map((i) => (
              <li key={i.id} style={{ display: 'flex', gap: 8 }}>
                <span aria-hidden="true" style={{ width: 18 }}>{i.ok ? '✓' : '!'}</span>
                <span><strong style={{ fontWeight: i.ok ? 400 : 600 }}>{i.label}</strong>{!i.ok && <span className="muted" style={{ display: 'block' }}>{i.detail}</span>}</span>
              </li>
            ))}
          </ul>
          {check.early > 0 && <p className="hint" style={{ margin: '8px 0 0' }}>{check.early} unit{check.early === 1 ? ' was' : 's were'} picked up early with the owner's reason in the equipment log.</p>}
        </div>
      )}

      {drying && (
        <>
          {contents.length > 1 && (
            <div className="field" style={{ maxWidth: 320, marginTop: 12 }}>
              <label htmlFor="rep-sketch">Sketch for the drying reports</label>
              <select id="rep-sketch" value={sketchId || ''} onChange={(e) => setSketchId(e.target.value)}>
                {contents.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.readings} reading{c.readings === 1 ? '' : 's'})</option>)}
              </select>
            </div>
          )}
          {drying.items.map((it) => {
            const def = DRYING_REPORTS.find((d) => d.key === it.key);
            const ready = dryingReady(def, chosenContents);
            return (
              <Row key={it.key} note={noteFor(it.key)} title={it.title} text={it.text} ready={ready} hint={it.hint}
                button={<button type="button" className={it.format === 'pdf' ? 'primary' : 'secondary'} disabled={!ready} aria-busy={busy === it.key} onClick={() => makeDrying(def)}>{busy === it.key ? 'Making…' : it.format === 'pdf' ? 'Download PDF' : 'Download CSV'}</button>} />
            );
          })}
          {isOwner && <Row title="Daily burn" note={noteFor('burn')} text="What the job costs per calendar day (equipment on site and logged hours) with a running total. Owner only: it shows your own costs." button={pdfBtn('burn', makeBurn)} />}
          {isOffice && <Row title="Adjuster link" text="A read-only web page of the drying report for the insurance adjuster. It expires in 90 days and you can turn it off." button={<button type="button" className="secondary" onClick={() => setLinkOpen(true)}>Manage links</button>} />}
        </>
      )}
      {linkOpen && <AdjusterLink jobId={jobId} onClose={() => setLinkOpen(false)} />}
    </div>
  );
}
