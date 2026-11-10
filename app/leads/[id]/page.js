'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import LeadForm, { pickLeadFields } from '@/components/LeadForm';
import EstimateCard from '@/components/EstimateCard';
import PopupModal from '@/components/PopupModal';
import AppointmentPicker, { defaultAppointment } from '@/components/AppointmentPicker';
import { getSupabase } from '@/lib/supabaseClient';
import { fromLocalInput, fmtDateTime, LEAD_STATUS, JOB_TYPES, leadDisplayName, addressLine } from '@/lib/format';
import { displayPhone, telHref } from '@/lib/phone';
import { staffName, displayNameFor } from '@/lib/userDisplay';

const WORK_ORDER_ERRORS = {
  TECH_DOUBLE_BOOKED: 'That tech is already booked then. Tick the box to book anyway, or pick another time or tech.',
  LEAD_NEEDS_NAME: 'Add a name or company before creating the work order.',
  LEAD_NEEDS_ADDRESS: 'Add the service address before creating the work order.',
  LEAD_ALREADY_BOOKED: 'This lead already has a work order.',
  LEAD_IS_LOST: 'This lead is marked lost. Reopen it first.',
  NOT_ALLOWED: 'Only the office and owner can create work orders.',
};
const friendly = (m) => WORK_ORDER_ERRORS[Object.keys(WORK_ORDER_ERRORS).find((k) => (m || '').includes(k))] || m;

const LEAD_TABS = [
  ['overview', 'Overview'],
  ['details', 'Details'],
  ['estimate', 'Estimate'],
  ['history', 'History'],
];
const tabFromHash = () => {
  const raw = typeof window === 'undefined' ? '' : window.location.hash.replace('#', '');
  return LEAD_TABS.some(([k]) => k === raw) ? raw : 'overview';
};

function LeadInner({ id, staff, token }) {
  const router = useRouter();
  const [lead, setLead] = useState(null);
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [events, setEvents] = useState([]);
  const [matches, setMatches] = useState([]);
  const [linked, setLinked] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [appt, setAppt] = useState(defaultAppointment);
  const [conflicts, setConflicts] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('overview');
  const [woOpen, setWoOpen] = useState(false);

  // keep the open tab across refreshes and back/forward (#overview, #details ...)
  useEffect(() => {
    setTab(tabFromHash());
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const openTab = (k) => { setTab(k); window.history.replaceState(null, '', `#${k}`); };

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data: l } = await sb.from('leads').select('*').eq('id', id).maybeSingle();
    setLead(l);
    if (!l) return;
    setForm((cur) => cur ?? pickLeadFields(l));
    const [ev, st, est, cu] = await Promise.all([
      sb.from('job_events').select('*').eq('lead_id', id).order('at', { ascending: false }).limit(50),
      sb.from('staff_users').select('id,full_name,email,role').eq('active', true).order('full_name'),
      sb.from('estimates').select('id,status').eq('lead_id', id).maybeSingle(),
      l.customer_id ? sb.from('customers').select('id,display_name,phone,email').eq('id', l.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setEvents(ev.data || []);
    setStaffList(st.data || []);
    setEstimate(est.data || null);
    setLinked(cu.data || null);
    if (!l.customer_id && (l.phone || l.email)) {
      const { data: m } = await sb.rpc('find_customer_matches', { p_phone: l.phone, p_email: l.email });
      setMatches(m || []);
    } else {
      setMatches([]);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // keep the page current when the customer approves from their phone
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) getSupabase().from('leads').select('status').eq('id', id).maybeSingle().then(({ data }) => { if (data && lead && data.status !== lead.status) load(); }); }, 20000);
    return () => clearInterval(t);
  }, [id, lead, load]);

  if (!lead || !form) return <p className="muted">Loading lead...</p>;

  // Who did it, by name. Falls back to a tidied email for people no longer in the active list.
  const actorName = (e) => {
    const s = staffList.find((x) => x.id === e.actor_id);
    if (s) return staffName(s);
    return e.actor_email ? displayNameFor(null, e.actor_email) : 'customer / system';
  };

  const open = !['booked', 'lost'].includes(lead.status);
  const change = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };

  async function save() {
    setMsg(null);
    const { error } = await getSupabase().from('leads').update(pickLeadFields(form)).eq('id', id);
    if (error) { setMsg({ err: true, text: error.message }); return false; }
    setDirty(false);
    return true;
  }

  async function onSave(e) {
    e.preventDefault();
    if (await save()) { setMsg({ text: 'Saved.' }); load(); }
  }

  async function setStatus(status, extra = {}) {
    const { error } = await getSupabase().from('leads').update({ status, ...extra }).eq('id', id);
    if (error) setMsg({ err: true, text: error.message });
    else { setMsg(null); load(); }
  }

  async function markLost() {
    const reason = window.prompt('Why was this lead lost? (optional)');
    if (reason === null) return;
    setStatus('lost', { lost_reason: reason });
  }

  async function reopen() {
    // back to whatever the estimate says
    const status = estimate?.status === 'approved' ? 'accepted' : estimate?.status === 'sent' || estimate?.status === 'declined' ? 'quoted' : 'new';
    setStatus(status, { lost_reason: '' });
  }

  // Owner only (matches the database rule). A lead that became a work order stays, because the job came from it.
  async function deleteLead() {
    if (!window.confirm(`Delete ${leadDisplayName(lead) || 'this lead'} permanently? This also removes its estimate and history. It cannot be undone.`)) return;
    setBusy(true);
    setMsg(null);
    const { data, error } = await getSupabase().from('leads').delete().eq('id', id).select('id');
    if (error || !data?.length) {
      setMsg({ err: true, text: error?.message || 'Could not delete this lead. Only the owner can delete leads.' });
      setBusy(false);
      return;
    }
    router.push('/leads');
  }

  async function linkCustomer(customerId) {
    const { error } = await getSupabase().from('leads').update({ customer_id: customerId }).eq('id', id);
    if (error) setMsg({ err: true, text: error.message });
    else load();
  }

  async function createWorkOrder() {
    setMsg(null);
    if (conflicts.length && !appt.override) { setMsg({ err: true, text: WORK_ORDER_ERRORS.TECH_DOUBLE_BOOKED }); return; }
    if (!form.street.trim()) { setMsg({ err: true, text: WORK_ORDER_ERRORS.LEAD_NEEDS_ADDRESS }); return; }
    setBusy(true);
    if (dirty && !(await save())) { setBusy(false); return; }
    const { data: jobId, error } = await getSupabase().rpc('create_work_order', {
      p_lead: id,
      p_starts_at: fromLocalInput(appt.start),
      p_duration_minutes: appt.duration,
      p_tech: appt.techId || null,
      p_allow_conflict: !!appt.override,
    });
    if (error) { setMsg({ err: true, text: friendly(error.message) }); setBusy(false); return; }
    router.push(`/jobs/${jobId}`);
  }

  const name = leadDisplayName(lead) || displayPhone(lead.phone) || 'Unnamed lead';
  const estApproved = estimate?.status === 'approved';

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{name} <span className={`badge s-${lead.status}`}>{LEAD_STATUS[lead.status]}</span></h1>
        <div className="row">
          {open && <button className="primary" onClick={() => { setMsg(null); setWoOpen(true); }}>Create work order</button>}
          {open && <button className="danger" onClick={markLost}>Mark lost</button>}
          {lead.status === 'lost' && <button className="secondary" onClick={reopen}>Reopen</button>}
          {staff.role === 'owner' && lead.status !== 'booked' && <button className="danger" disabled={busy} onClick={deleteLead}>Delete lead</button>}
          {lead.status === 'booked' && lead.job_id && <Link href={`/jobs/${lead.job_id}`}><button className="primary">Open work order</button></Link>}
        </div>
      </div>
      <p className="sub">Lead added {fmtDateTime(lead.created_at)}{lead.status === 'lost' && lead.lost_reason ? ` · Lost: ${lead.lost_reason}` : ''}</p>

      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}

      {lead.status === 'accepted' && (
        <div className="banner ok">
          The customer approved the estimate {fmtDateTime(lead.accepted_at)}. Pick a time below to create the work order.
          {lead.preferred_times && <div style={{ fontWeight: 400, marginTop: 4 }}>Their preferred times: {lead.preferred_times}</div>}
        </div>
      )}
      {lead.status === 'booked' && <div className="banner ok">A work order was created from this lead. Further changes happen on the job.</div>}

      <div className="tabs" role="tablist">
        {LEAD_TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => openTab(k)}>
            {label}
            {k === 'details' && dirty && <span className="tab-count" title="Unsaved changes">!</span>}
            {k === 'history' && events.length > 0 && <span className="tab-count">{events.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="lead-tab">
          {open && !lead.customer_id && matches.length > 0 && (
            <div className="card">
              <h2>Existing customer?</h2>
              <p className="hint">This phone number or email matches a customer already on file. Use them to keep one history and their saved addresses.</p>
              {matches.map((m) => (
                <div key={m.id} className="list-item row" style={{ justifyContent: 'space-between' }}>
                  <div><div className="title">{m.display_name}</div><div className="meta">{[displayPhone(m.phone), m.email].filter(Boolean).join(' · ')}</div></div>
                  <div className="row">
                    <Link href={`/customers/${m.id}`}><button type="button" className="secondary small">View</button></Link>
                    <button type="button" className="primary small" onClick={() => linkCustomer(m.id)}>Use this customer</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {linked && (
            <div className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>Existing customer: <Link href={`/customers/${linked.id}`}><strong>{linked.display_name}</strong></Link>
                  <div className="meta">The work order uses their customer record. Contact edits on the Details tab do not change it.</div></div>
                {open && <button type="button" className="secondary small" onClick={() => linkCustomer(null)}>Unlink</button>}
              </div>
            </div>
          )}

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>Summary</h2>
              <button type="button" className="secondary small" onClick={() => openTab('details')}>Edit details</button>
            </div>
            <div className="grid2">
              <div className="field"><label>Contact</label>
                <div className="title">{name}</div>
                <div className="meta">
                  {lead.phone && <a href={telHref(lead.phone)}>{displayPhone(lead.phone)}</a>}
                  {lead.phone && lead.email ? ' · ' : ''}
                  {lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}
                  {!lead.phone && !lead.email && 'No phone or email yet'}
                </div>
              </div>
              <div className="field"><label>Service address</label>
                <div className="title">{addressLine(lead) || 'No address yet'}</div>
                {(lead.gate_code || lead.warnings) && <div className="meta">{[lead.gate_code && `Gate ${lead.gate_code}`, lead.warnings].filter(Boolean).join(' · ')}</div>}
              </div>
              <div className="field"><label>Job</label>
                <div className="title">{JOB_TYPES[lead.job_type] || lead.job_type || '-'}</div>
                {lead.service_requested && <div className="meta">{lead.service_requested}</div>}
              </div>
              <div className="field"><label>Estimate</label>
                <div className="title">{estimate ? estimate.status.replace(/_/g, ' ') : 'None yet'}</div>
                <div className="meta"><button type="button" className="linklike" onClick={() => openTab('estimate')}>{estimate ? 'Open estimate' : 'Create estimate'}</button></div>
              </div>
            </div>
            {lead.loss_summary && <div className="field"><label>Loss summary</label><div>{lead.loss_summary}</div></div>}
            {lead.notes && <div className="field"><label>Internal notes</label><div style={{ whiteSpace: 'pre-wrap' }}>{lead.notes}</div></div>}
          </div>

        </div>
      )}

      {tab === 'details' && (
        <div className="lead-tab">
          <form onSubmit={onSave}>
            <fieldset disabled={!open} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <LeadForm value={form} onChange={change} />
            </fieldset>
            {open && <div className="row" style={{ marginBottom: 20 }}>
              <button className="primary">Save changes</button>
              {dirty && <span className="muted">Unsaved changes</span>}
            </div>}
          </form>
        </div>
      )}

      {tab === 'estimate' && (
        <div className="lead-tab">
          <EstimateCard
            scope={{ leadId: id }}
            open={open}
            staff={staff}
            token={token}
            contact={{ name, phone: lead.phone, email: lead.email }}
            onChanged={load}
          />
        </div>
      )}

      {tab === 'history' && (
        <div className="lead-tab">
          <div className="card">
            <h2>History</h2>
            {events.map((e) => (
              <div key={e.id} className="list-item">
                <div className="title">{e.kind.replace(/_/g, ' ')}</div>
                <div className="meta">{fmtDateTime(e.at)} · {actorName(e)}</div>
              </div>
            ))}
            {events.length === 0 && <p className="muted">No history yet.</p>}
          </div>
        </div>
      )}
      <PopupModal open={woOpen} onClose={() => { if (!busy) setWoOpen(false); }} title="Create work order">
        <p className="hint">
          Pick the start time and how long it will take. Creating the work order turns this lead into a job with its first visit,
          and the estimate moves onto the job.
        </p>
        {!estApproved && (
          <div className="banner">
            {estimate ? 'The customer has not approved the estimate yet.' : 'There is no estimate yet.'} You can still create the work order, for example if they approved by phone.
          </div>
        )}
        {msg?.err && <div className="msg err">{msg.text}</div>}
        <AppointmentPicker value={appt} onChange={setAppt} staffList={staffList} onConflicts={setConflicts} />
        <div className="row" style={{ marginTop: 14 }}>
          <button className="primary" disabled={busy} onClick={createWorkOrder}>{busy ? 'Creating...' : 'Create work order'}</button>
          <button className="secondary" disabled={busy} onClick={() => setWoOpen(false)}>Cancel</button>
        </div>
      </PopupModal>
    </>
  );
}

export default function LeadPage() {
  const { id } = useParams();
  return <AuthGate officeOnly>{({ staff, token }) => <LeadInner id={id} staff={staff} token={token} />}</AuthGate>;
}
