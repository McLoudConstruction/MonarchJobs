'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import VisitForm from '@/components/VisitForm';
import VisitActions from '@/components/VisitActions';
import EstimateCard from '@/components/EstimateCard';
import { getSupabase } from '@/lib/supabaseClient';
import { doubleBookedIds } from '@/lib/schedule';
import { fmtDateTime, fmtDuration, JOB_STATUS, JOB_TYPES, addressLine } from '@/lib/format';
import { displayPhone, telHref } from '@/lib/phone';

const JOB_TABS = [['customer', 'Customer info'], ['details', 'Job Details'], ['estimate', 'Estimate Details']];
const tabFromHash = () => {
  const h = typeof window === 'undefined' ? '' : window.location.hash.replace('#', '');
  return JOB_TABS.some(([k]) => k === h) ? h : 'customer';
};

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
  const [tab, setTab] = useState('customer');

  // keep the open tab across refreshes and back/forward (#customer, #details, #estimate)
  useEffect(() => {
    setTab(tabFromHash());
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const openTab = (k) => { setTab(k); window.history.replaceState(null, '', `#${k}`); };

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data: j } = await sb.from('jobs')
      .select('*,customer:customers(id,display_name,phone,email,customer_type),address:addresses(*)')
      .eq('id', id).maybeSingle();
    setJob(j);
    if (!j) return;
    setForm({
      status: j.status, job_type: j.job_type, po_number: j.po_number, loss_summary: j.loss_summary,
      customer_notes: j.customer_notes, internal_notes: j.internal_notes, warning: j.warning, billing_contact_id: j.billing_contact_id || '',
    });
    const [v, ct, jc, ev, st] = await Promise.all([
      sb.from('job_visits').select('*').eq('job_id', id).order('starts_at'),
      isOffice ? sb.from('contacts').select('*').eq('customer_id', j.customer_id) : Promise.resolve({ data: [] }),
      sb.from('job_contacts').select('contact_id').eq('job_id', id),
      sb.from('job_events').select('*').eq('job_id', id).order('at', { ascending: false }).limit(50),
      sb.from('staff_users').select('id,full_name,email,role').eq('active', true),
    ]);
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

  if (!job || !form) return <p className="muted">Loading job...</p>;

  const name = (uid) => {
    const s = staffList.find((x) => x.id === uid);
    return s ? s.full_name || s.email : 'Unassigned';
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function logEvent(kind, details) {
    await getSupabase().from('job_events').insert({ job_id: id, actor_id: staff.id, actor_email: staff.email, kind, details });
  }

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

  const warnings = [job.address?.warnings, job.warning].filter(Boolean);
  const anyFlag = visits.some((v) => flagged.has(v.id) && v.status !== 'cancelled');

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Job #{job.job_number} <span className={`badge s-${job.status}`}>{JOB_STATUS[job.status]}</span></h1>
      </div>
      <p className="sub">
        {isOffice ? <Link href={`/customers/${job.customer.id}`}>{job.customer.display_name}</Link> : job.customer.display_name}
        {' · '}{JOB_TYPES[job.job_type]}
        {isOffice && job.lead_id && <>{' · '}<Link href={`/leads/${job.lead_id}`}>From lead</Link></>}
      </p>

      {warnings.map((w, i) => <div key={i} className="banner">Warning: {w}</div>)}
      {anyFlag && <div className="banner flag">Double-booked: one of this job's visits overlaps another visit for the same tech. Move one of them.</div>}
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}

      <div className="tabs" role="tablist">
        {JOB_TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => openTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'customer' && (
        <>
      <div className="card">
        <h2>Customer</h2>
        <div className="title">{isOffice ? <Link href={`/customers/${job.customer.id}`}>{job.customer.display_name}</Link> : job.customer.display_name}</div>
        <div>
          {job.customer.phone && <a href={telHref(job.customer.phone)}>{displayPhone(job.customer.phone)}</a>}
          {job.customer.email && <>{job.customer.phone ? ' · ' : ''}<a href={`mailto:${job.customer.email}`}>{job.customer.email}</a></>}
          {!job.customer.phone && !job.customer.email && <span className="muted">No phone or email on file.</span>}
        </div>
      </div>

      <div className="card">
        <h2>Site</h2>
        <div className="title">{addressLine(job.address)}</div>
        {job.address.gate_code && <div>Gate code: <strong>{job.address.gate_code}</strong></div>}
        {job.address.access_notes && <div className="meta">{job.address.access_notes}</div>}
      </div>

      {isOffice && contacts.length > 0 && (
        <div className="card">
          <h2>Also notify</h2>
          <p className="hint">Extra contacts receive this job's notifications once messaging is switched on.</p>
          {contacts.map((c) => (
            <label key={c.id} className="row" style={{ marginBottom: 8 }}>
              <input type="checkbox" checked={jobContactIds.includes(c.id)} onChange={() => toggleContact(c.id)} />
              {c.name} {c.role && <span className="badge off">{c.role}</span>} <span className="muted">{[displayPhone(c.phone), c.email].filter(Boolean).join(' · ')}</span>
            </label>
          ))}
        </div>
      )}

        </>
      )}

      {tab === 'details' && (
        <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Visits</h2>
          {isOffice && <button className="secondary small" onClick={() => setVisitEdit({})}>Add visit</button>}
        </div>
        {visits.map((v) => (
          <div key={v.id} className="list-item">
            <div className="title">
              {fmtDateTime(v.starts_at)} for {fmtDuration(v.duration_minutes)}{' '}
              <span className="badge off">{VISIT_STATUS[v.status]}</span>
              {flagged.has(v.id) && v.status !== 'cancelled' && <> <span className="badge warn">Double-booked</span></>}
            </div>
            <div className="meta">{name(v.tech_id)}{v.minutes_out ? ` · ${v.minutes_out} min out` : ''}</div>
            {(isOffice || v.tech_id === staff.id) && <VisitActions visit={v} token={token} onDone={load} />}
            {isOffice && v.status === 'scheduled' && (
              <div className="row" style={{ marginTop: 6 }}>
                <button className="secondary small" onClick={() => setVisitEdit(v)}>Reschedule / reassign</button>
                <button className="danger small" onClick={() => cancelVisit(v)}>Cancel visit</button>
              </div>
            )}
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
          <div className="field"><label>Internal notes</label><textarea value={form.internal_notes} onChange={set('internal_notes')} /><div className="note">Never shown to the customer.</div></div>
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

      <div className="card">
        <h2>History</h2>
        {events.map((e) => (
          <div key={e.id} className="list-item">
            <div className="title">{e.kind.replace(/_/g, ' ')}</div>
            <div className="meta">{fmtDateTime(e.at)} · {e.actor_email || 'system'}</div>
          </div>
        ))}
        {events.length === 0 && <p className="muted">No history yet.</p>}
      </div>
        </>
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
    </>
  );
}

export default function JobPage() {
  const { id } = useParams();
  return <AuthGate>{({ staff, token }) => <JobInner id={id} staff={staff} token={token} />}</AuthGate>;
}
