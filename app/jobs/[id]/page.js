'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import VisitForm from '@/components/VisitForm';
import VisitActions from '@/components/VisitActions';
import OnTheWayModal from '@/components/OnTheWayModal';
import AssignJobModal from '@/components/AssignJobModal';
import VisitDock from '@/components/VisitDock';
import EstimateCard from '@/components/EstimateCard';
import PhotosTab from '@/components/job/PhotosTab';
import SketchTab from '@/components/job/SketchTab';
import MoistureTab from '@/components/job/MoistureTab';
import UpdatesTab from '@/components/job/UpdatesTab';
import JobFab from '@/components/job/JobFab';
import PhotoViewer from '@/components/job/PhotoViewer';
import { UploadStatus } from '@/components/job/PhotoUi';
import { usePhotoUploader } from '@/lib/usePhotoUploader';
import { eventLabel, updateRecipients, INTERNAL_CATEGORIES } from '@/lib/jobDocs';
import { fabActions, FAB_LABELS, FAB_HIDDEN_TABS } from '@/lib/jobFab';
import { getSupabase } from '@/lib/supabaseClient';
import { doubleBookedIds } from '@/lib/schedule';
import { fmtDateTime, fmtDuration, JOB_STATUS, JOB_TYPES, addressLine } from '@/lib/format';
import { displayPhone, telHref } from '@/lib/phone';
import { staffName, displayNameFor } from '@/lib/userDisplay';
import { apiFetch } from '@/lib/useAuth';

const JOB_TABS = [
  ['overview', 'Overview'],
  ['details', 'Details'],
  ['photos', 'Photos'],
  ['sketch', 'Sketch'],
  ['moisture', 'Moisture'],
  ['updates', 'Updates'],
  ['estimate', 'Estimate'],
  ['history', 'History'],
];
// links and bookmarks made before the tabs were reworked (#customer was the first tab)
const OLD_TABS = { customer: 'overview' };
const tabFromHash = () => {
  const raw = typeof window === 'undefined' ? '' : window.location.hash.replace('#', '');
  const h = OLD_TABS[raw] || raw;
  return JOB_TABS.some(([k]) => k === h) ? h : 'overview';
};

// A missing table means migration 007 has not been run yet.
const missingTable = (err) => !!err && (err.code === '42P01' || /does not exist|schema cache|Could not find the table/i.test(err.message || ''));

const VISIT_STATUS = { scheduled: 'Scheduled', on_the_way: 'On the way', started: 'Started', finished: 'Finished', cancelled: 'Cancelled' };

function JobInner({ id, staff, token }) {
  const isOffice = staff.role !== 'tech';
  const [job, setJob] = useState(null);
  const [visits, setVisits] = useState([]);
  const [flagged, setFlagged] = useState(new Set());
  const [contacts, setContacts] = useState([]);
  const [jobContactIds, setJobContactIds] = useState([]);
  const [events, setEvents] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState(null);
  const [visitEdit, setVisitEdit] = useState(null); // visit object, or {} for new
  const [tab, setTab] = useState('overview');
  const [sketchId, setSketchId] = useState(null); // the sketch both the Sketch and Moisture tabs have open
  const [photos, setPhotos] = useState([]);
  const [sketches, setSketches] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [docsMissing, setDocsMissing] = useState(false);
  const [viewer, setViewer] = useState(null); // { ids, startId }
  const roomInput = useRef(null);
  const roomTarget = useRef(null);
  const [otwOpen, setOtwOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  // one-shot requests from the phone's action button to a tab: { n } objects, cleared by the tab once it has acted
  const [moistCmd, setMoistCmd] = useState(null);
  const [updCmd, setUpdCmd] = useState(null);

  // keep the open tab across refreshes and back/forward (#overview, #photos, #sketch ...)
  useEffect(() => {
    setTab(tabFromHash());
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const openTab = (k) => { setTab(k); window.history.replaceState(null, '', `#${k}`); };
  // a request left over for a tab that is no longer open is dropped
  useEffect(() => {
    if (tab !== 'moisture') setMoistCmd(null);
    if (tab !== 'updates') setUpdCmd(null);
  }, [tab]);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data: j } = await sb.from('jobs')
      .select('*,customer:customers(id,display_name,first_name,last_name,company_name,phone,email,customer_type),address:addresses(*)')
      .eq('id', id).maybeSingle();
    setJob(j);
    if (!j) return;
    setForm({
      status: j.status, job_type: j.job_type, po_number: j.po_number, loss_summary: j.loss_summary,
      customer_notes: j.customer_notes, internal_notes: j.internal_notes, warning: j.warning, billing_contact_id: j.billing_contact_id || '',
    });
    const [v, ct, jc, ev, st, ph, sk, up] = await Promise.all([
      sb.from('job_visits').select('*').eq('job_id', id).order('starts_at'),
      isOffice ? sb.from('contacts').select('*').eq('customer_id', j.customer_id) : Promise.resolve({ data: [] }),
      sb.from('job_contacts').select('contact_id').eq('job_id', id),
      sb.from('job_events').select('*').eq('job_id', id).order('at', { ascending: false }).limit(50),
      sb.from('staff_users').select('id,full_name,email,role').eq('active', true),
      sb.from('job_photos').select('*').eq('job_id', id).order('taken_at', { ascending: false }),
      sb.from('job_sketches').select('id,name,sort_order,created_at').eq('job_id', id).order('sort_order').order('created_at'),
      sb.from('job_updates').select('*').eq('job_id', id).order('created_at', { ascending: false }),
    ]);
    setDocsMissing(missingTable(ph.error) || missingTable(sk.error) || missingTable(up.error));
    setPhotos(ph.data || []);
    setSketches(sk.data || []);
    setUpdates(up.data || []);
    setVisits(v.data || []);
    setContacts(ct.data || []);
    setJobContactIds((jc.data || []).map((r) => r.contact_id));
    setEvents(ev.data || []);
    setStaffList(st.data || []);

    // Double-booking flags: compare this job's visits with the same techs' other visits
    const techIds = [...new Set((v.data || []).map((x) => x.tech_id).filter(Boolean))];
    if (isOffice && techIds.length) {
      const { data: others } = await sb.from('job_visits').select('id,tech_id,starts_at,ends_at,status').in('tech_id', techIds).in('status', ['scheduled', 'on_the_way', 'started']);
      const flaggedIds = doubleBookedIds(others || []);
      setFlagged(flaggedIds);
    }
  }, [id, isOffice]);

  useEffect(() => { load(); }, [load]);

  // Refresh only the history, so edits being typed in the job details form are not wiped.
  const loadEvents = useCallback(async () => {
    const { data } = await getSupabase().from('job_events').select('*').eq('job_id', id).order('at', { ascending: false }).limit(50);
    setEvents(data || []);
  }, [id]);

  const reloadPhotos = useCallback(async () => {
    const { data } = await getSupabase().from('job_photos').select('*').eq('job_id', id).order('taken_at', { ascending: false });
    setPhotos(data || []);
  }, [id]);
  const reloadSketches = useCallback(async () => {
    const { data } = await getSupabase().from('job_sketches').select('id,name,sort_order,created_at').eq('job_id', id).order('sort_order').order('created_at');
    setSketches(data || []);
  }, [id]);
  const reloadUpdates = useCallback(async () => {
    const { data } = await getSupabase().from('job_updates').select('*').eq('job_id', id).order('created_at', { ascending: false });
    setUpdates(data || []);
    loadEvents();
  }, [id, loadEvents]);

  const logEvent = useCallback(async (kind, details) => {
    await getSupabase().from('job_events').insert({ job_id: id, actor_id: staff.id, actor_email: staff.email, kind, details });
    loadEvents();
  }, [id, staff.id, staff.email, loadEvents]);

  const uploader = usePhotoUploader({ jobId: id, onUploaded: reloadPhotos, logEvent });
  const photosById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);

  if (!job || !form) return <p className="muted">Loading job...</p>;

  const openViewer = (list, startId) => setViewer({ ids: list.map((p) => p.id), startId });
  const viewerList = viewer ? viewer.ids.map((i) => photosById.get(i)).filter(Boolean) : [];
  const authorName = (uid) => {
    const s = staffList.find((x) => x.id === uid);
    return s ? staffName(s) : '';
  };
  function addRoomPhoto(sketchId, room) {
    roomTarget.current = { sketchId, roomKey: room.id };
    roomInput.current?.click();
  }

  const name = (uid) => {
    const s = staffList.find((x) => x.id === uid);
    return s ? staffName(s) : 'Unassigned';
  };
  // Who did it, by name. Falls back to a tidied email for people no longer in the active list.
  const actorName = (e, none) => {
    const s = staffList.find((x) => x.id === e.actor_id);
    if (s) return staffName(s);
    return e.actor_email ? displayNameFor(null, e.actor_email) : none;
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function saveJob(e) {
    e.preventDefault();
    setMsg(null);
    const patch = { ...form, billing_contact_id: form.billing_contact_id || null };
    if (patch.status === 'completed' && job.status !== 'completed') patch.completed_at = new Date().toISOString();
    const { error } = await getSupabase().from('jobs').update(patch).eq('id', id);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    const changed = {};
    for (const k of Object.keys(form)) {
      const before = k === 'billing_contact_id' ? job[k] || '' : job[k];
      if (before !== form[k]) changed[k] = { from: before, to: form[k] };
    }
    if (Object.keys(changed).length) await logEvent(changed.status ? 'status' : 'edited', changed);
    setMsg({ text: 'Saved.' });
    load();
  }

  async function toggleContact(cid) {
    const sb = getSupabase();
    if (jobContactIds.includes(cid)) await sb.from('job_contacts').delete().eq('job_id', id).eq('contact_id', cid);
    else await sb.from('job_contacts').insert({ job_id: id, contact_id: cid });
    await logEvent('contact_' + (jobContactIds.includes(cid) ? 'removed' : 'added'), { contact_id: cid });
    load();
  }

  async function cancelVisit(v) {
    if (!window.confirm('Cancel this visit?')) return;
    await getSupabase().from('job_visits').update({ status: 'cancelled' }).eq('id', v.id);
    await logEvent('visit_cancelled', { visit_id: v.id });
    load();
  }

  // the address warning (pets) shows in the Site card; only the job-level warning stays a banner
  const warnings = [job.warning].filter(Boolean);
  // the visit "On the way" applies to: the next one still waiting, if this person may act on it
  const otwVisit = visits.find((v) => ['scheduled', 'on_the_way'].includes(v.status) && (isOffice || v.tech_id === staff.id));
  // a visit still waiting with nobody on it: the office sees a red Assign Job button
  const unassignedVisit = isOffice ? visits.find((v) => v.status === 'scheduled' && !v.tech_id) : null;
  // the phone's action bar follows the visit under way, otherwise the next one waiting
  const dockVisit = visits.find((v) => v.status === 'started' && (isOffice || v.tech_id === staff.id)) || otwVisit;
  // phone action button: Start Recheck / Start Sketch / Start Job, which becomes Complete Job once the visit is under way
  const fabKeys = FAB_HIDDEN_TABS.includes(tab) ? [] : fabActions({ hasSketch: sketches.length > 0, visitStatus: dockVisit?.status || null, docsMissing });
  const fabRun = {
    recheck: () => { openTab('moisture'); setMoistCmd({ type: 'recheck', n: Date.now() }); },
    sketch: () => openTab('sketch'),
    otw: () => setOtwOpen(true),
    start: async () => {
      await apiFetch(`/api/visits/${dockVisit.id}/status`, token, { method: 'POST', body: JSON.stringify({ action: 'started' }) });
      await load();
    },
    complete: () => { openTab('updates'); setUpdCmd({ kind: 'internal', category: 'Completed Job', n: Date.now() }); },
    internal: () => { openTab('updates'); setUpdCmd({ kind: 'internal', category: INTERNAL_CATEGORIES[0], n: Date.now() }); },
  };
  const fabItems = fabKeys.map((key) => ({ key, label: key === 'otw' && dockVisit?.status === 'on_the_way' ? 'Update ETA' : FAB_LABELS[key], onClick: fabRun[key] }));
  const contactName = [job.customer.first_name, job.customer.last_name].filter(Boolean).join(' ').trim();
  const anyFlag = visits.some((v) => flagged.has(v.id) && v.status !== 'cancelled');

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Job #{job.job_number} <span className={`badge s-${job.status}`}>{JOB_STATUS[job.status]}</span></h1>
        <div className="row" style={{ gap: 8 }}>
          {unassignedVisit && <button type="button" className="assign-btn" onClick={() => setAssignOpen(true)}>Assign Job</button>}
          {otwVisit && <button type="button" className="primary desktop-only" onClick={() => setOtwOpen(true)}>On the way</button>}
        </div>
      </div>
      <AssignJobModal open={assignOpen} visit={unassignedVisit} staffList={staffList} onClose={() => setAssignOpen(false)} onDone={load} logEvent={logEvent} />
      {otwVisit && <OnTheWayModal open={otwOpen} visit={otwVisit} token={token} onClose={() => setOtwOpen(false)} onDone={load} />}
      <p className="sub">
        {isOffice ? <Link href={`/customers/${job.customer.id}`}>{job.customer.display_name}</Link> : job.customer.display_name}
        {' · '}{JOB_TYPES[job.job_type]}
        {isOffice && job.lead_id && <>{' · '}<Link href={`/leads/${job.lead_id}`}>From lead</Link></>}
      </p>

      {warnings.map((w, i) => <div key={i} className="banner">Warning: {w}</div>)}
      {anyFlag && <div className="banner flag">Double-booked: one of this job's visits overlaps another visit for the same tech. Move one of them.</div>}
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}

      {docsMissing && (
        <div className="banner">Photos, sketches and updates are switched off until migration 007 is run in Supabase (SQL Editor, file supabase/migrations/007_job_documentation.sql).</div>
      )}

      <div className="tabs" role="tablist">
        {JOB_TABS.map(([k, label]) => {
          const n = k === 'photos' ? photos.filter((p) => !p.archived_at).length : k === 'sketch' ? sketches.length : k === 'updates' ? updates.length : 0;
          return (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => openTab(k)}>
              {label}{n > 0 && <span className="tab-count">{n}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && dockVisit && <VisitDock inline visit={dockVisit} token={token} onOtw={() => setOtwOpen(true)} onDone={load} />}

      {tab === 'overview' && (
        <div className="job-overview">
          <div className="card">
            <h2>Customer</h2>
            <div className="title">{isOffice ? <Link href={`/customers/${job.customer.id}`}>{job.customer.display_name}</Link> : job.customer.display_name}</div>
            {contactName && contactName !== job.customer.display_name && <div>{contactName}</div>}
            <div className="meta-line">
              {job.customer.phone && <a href={telHref(job.customer.phone)}>{displayPhone(job.customer.phone)}</a>}
              {job.customer.email && <>{job.customer.phone ? ' · ' : ''}<a href={`mailto:${job.customer.email}`}>{job.customer.email}</a></>}
              {!job.customer.phone && !job.customer.email && <span className="muted">No phone or email on file.</span>}
            </div>
          </div>

          <div className="card">
            <h2>Site</h2>
            <div className="title">{addressLine(job.address)}</div>
            {job.address.gate_code && <div>Gate code: <strong>{job.address.gate_code}</strong></div>}
            {job.address.warnings && <div>Pets: <strong>{job.address.warnings}</strong></div>}
            {job.address.access_notes && <div className="meta">{job.address.access_notes}</div>}
          </div>

          {job.loss_summary && (
            <div className="card wide">
              <h2>Loss summary</h2>
              <div>{job.loss_summary}</div>
            </div>
          )}

          <div className="card wide">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>Visits</h2>
              {isOffice && <button className="secondary small" onClick={() => setVisitEdit({})}>Add visit</button>}
            </div>
            {visits.map((v) => (
              <div key={v.id} className="visit-row">
                <div className="visit-main">
                  <div className="title">
                    {fmtDateTime(v.starts_at)} for {fmtDuration(v.duration_minutes)}{' '}
                    <span className="badge off">{VISIT_STATUS[v.status]}</span>
                    {flagged.has(v.id) && v.status !== 'cancelled' && <> <span className="badge warn">Double-booked</span></>}
                  </div>
                  <div className="meta">{name(v.tech_id)}{v.minutes_out ? ` · ${v.minutes_out} min out` : ''}</div>
                </div>
                <div className="visit-buttons">
                  {(isOffice || v.tech_id === staff.id) && <VisitActions visit={v} token={token} onDone={load} />}
                  {isOffice && v.status === 'scheduled' && (
                    <>
                      <button className="secondary small" onClick={() => setVisitEdit(v)}>Reschedule / reassign</button>
                      <button className="danger small" onClick={() => cancelVisit(v)}>Cancel visit</button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {visits.length === 0 && <p className="muted">No visits scheduled.</p>}
            {visitEdit && (
              <VisitForm
                jobId={id}
                visit={visitEdit.id ? visitEdit : null}
                staffList={staffList}
                staff={staff}
                onDone={() => { setVisitEdit(null); load(); }}
                onCancel={() => setVisitEdit(null)}
                logEvent={logEvent}
              />
            )}
          </div>

          {isOffice && contacts.length > 0 && (
            <div className="card wide">
              <h2>Also notify</h2>
              <p className="hint">Extra contacts receive this job's progress updates (and its other notifications once messaging is switched on).</p>
              {contacts.map((c) => (
                <label key={c.id} className="row" style={{ marginBottom: 8 }}>
                  <input type="checkbox" checked={jobContactIds.includes(c.id)} onChange={() => toggleContact(c.id)} />
                  {c.name} {c.role && <span className="badge off">{c.role}</span>} <span className="muted">{[displayPhone(c.phone), c.email].filter(Boolean).join(' · ')}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'details' && (
        <>
      {isOffice ? (
        <form className="card" onSubmit={saveJob}>
          <h2>Job details</h2>
          <div className="grid2">
            <div className="field"><label>Status</label>
              <select value={form.status} onChange={set('status')}>
                {Object.entries(JOB_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="field"><label>Type</label>
              <select value={form.job_type} onChange={set('job_type')}>
                {Object.entries(JOB_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="field"><label>PO number</label><input value={form.po_number} onChange={set('po_number')} /></div>
            <div className="field"><label>Billing contact</label>
              <select value={form.billing_contact_id} onChange={set('billing_contact_id')}>
                <option value="">Customer ({job.customer.display_name})</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.role ? ` (${c.role})` : ''}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label>Loss summary for the tech</label><input value={form.loss_summary} onChange={set('loss_summary')} /></div>
          <div className="field"><label>Job warning (banner)</label><input value={form.warning} onChange={set('warning')} /></div>
          <div className="field"><label>Customer-facing notes</label><textarea value={form.customer_notes} onChange={set('customer_notes')} /><div className="note">May appear on estimates and invoices.</div></div>
          <div className="field"><label>Internal notes</label><textarea value={form.internal_notes} onChange={set('internal_notes')} /><div className="note">Never shown to the customer. For dated notes with photos, use the Updates tab.</div></div>
          <button className="primary">Save job</button>
        </form>
      ) : (
        <div className="card">
          <h2>Notes</h2>
          {job.po_number && <p>PO: {job.po_number}</p>}
          {job.loss_summary && <p><strong>Loss summary:</strong> {job.loss_summary}</p>}
          <p><strong>Customer notes:</strong> {job.customer_notes || 'None'}</p>
          <p><strong>Internal notes:</strong> {job.internal_notes || 'None'}</p>
        </div>
      )}
        </>
      )}

      {tab === 'photos' && (
        <PhotosTab photos={photos} isOffice={isOffice} uploader={uploader} onOpen={openViewer} />
      )}

      {tab === 'sketch' && (
        <>
          <UploadStatus uploader={uploader} />
          <SketchTab
            jobId={id}
            sketches={sketches}
            photos={photos}
            isOffice={isOffice}
            staff={staff}
            staffList={staffList}
            logEvent={logEvent}
            onReload={reloadSketches}
            onAddRoomPhoto={addRoomPhoto}
            onViewPhotos={(list) => list.length && openViewer(list, list[0].id)}
            startId={sketchId}
            onActive={setSketchId}
            onOpenMoisture={() => openTab('moisture')}
          />
        </>
      )}

      {tab === 'moisture' && (
        <MoistureTab
          sketches={sketches}
          startId={sketchId}
          onActive={setSketchId}
          staff={staff}
          staffList={staffList}
          onOpenSketch={() => openTab('sketch')}
          command={moistCmd}
          onCommandDone={() => setMoistCmd(null)}
        />
      )}

      {tab === 'updates' && (
        <UpdatesTab
          jobId={id}
          updates={updates}
          photos={photos}
          isOffice={isOffice}
          staff={staff}
          token={token}
          authorName={authorName}
          logEvent={logEvent}
          onReload={reloadUpdates}
          uploader={uploader}
          onOpenPhotos={openViewer}
          recipients={updateRecipients(
            { name: job.customer.display_name, phone: job.customer.phone, email: job.customer.email },
            contacts.filter((c) => jobContactIds.includes(c.id)),
          )}
          baseUrl={typeof window === 'undefined' ? '' : window.location.origin}
          command={updCmd}
          onCommandDone={() => setUpdCmd(null)}
        />
      )}

      {tab === 'estimate' && (
        <>
      <EstimateCard
        scope={{ jobId: id }}
        open={!['closed', 'cancelled'].includes(job.status)}
        staff={staff}
        token={token}
        contact={{ name: job.customer.display_name, phone: job.customer.phone, email: job.customer.email }}
        onChanged={loadEvents}
      />

      <div className="card">
        <h2>Invoice</h2>
        <p className="muted">Invoicing and payments arrive in the next update.</p>
      </div>
        </>
      )}

      {tab === 'history' && (
        <div className="card">
          <h2>History</h2>
          {events.map((e) => (
            <div key={e.id} className="list-item">
              <div className="title">{eventLabel(e)}</div>
              <div className="meta">{fmtDateTime(e.at)} · {actorName(e, 'system')}</div>
            </div>
          ))}
          {events.length === 0 && <p className="muted">No history yet.</p>}
        </div>
      )}

      <JobFab items={fabItems} />

      <input
        ref={roomInput}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = [...e.target.files];
          e.target.value = '';
          const t = roomTarget.current;
          if (files.length && t) uploader.upload(files, { kind: 'during', sketchId: t.sketchId, roomKey: t.roomKey });
        }}
      />

      {viewer && viewerList.length > 0 && (
        <PhotoViewer
          list={viewerList}
          startId={viewer.startId}
          jobId={id}
          fileBase={`job-${job.job_number}`}
          authorName={authorName}
          logEvent={logEvent}
          onChanged={reloadPhotos}
          onAppend={(newId, afterId) => setViewer((v) => {
            if (!v) return v;
            const at = v.ids.indexOf(afterId);
            const ids = [...v.ids];
            ids.splice(at < 0 ? ids.length : at + 1, 0, newId);
            return { ...v, ids };
          })}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}

export default function JobPage() {
  const { id } = useParams();
  return <AuthGate>{({ staff, token }) => <JobInner id={id} staff={staff} token={token} />}</AuthGate>;
}
