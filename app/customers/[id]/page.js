'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabaseClient';
import { fmtDateTime, JOB_STATUS, addressLine } from '@/lib/format';
import PhoneInput from '@/components/PhoneInput';
import AddressFields from '@/components/AddressFields';
import { displayPhone } from '@/lib/phone';

const BLANK_ADDR = { label: '', street: '', unit: '', city: '', state: 'MO', zip: '', gate_code: '', warnings: '', access_notes: '' };
const BLANK_CONTACT = { name: '', phone: '', email: '', role: '', receives_notifications: true };

function Detail({ id }) {
  const [c, setC] = useState(null);
  const [addrs, setAddrs] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [msg, setMsg] = useState(null);
  const [editAddr, setEditAddr] = useState(null); // address object (id may be undefined for new)
  const [newContact, setNewContact] = useState(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [cu, ad, co, jb] = await Promise.all([
      sb.from('customers').select('*').eq('id', id).maybeSingle(),
      sb.from('addresses').select('*').eq('customer_id', id).order('created_at'),
      sb.from('contacts').select('*').eq('customer_id', id).order('created_at'),
      sb.from('jobs').select('id,job_number,status,job_type,created_at,address:addresses(street,city)').eq('customer_id', id).order('created_at', { ascending: false }),
    ]);
    setC(cu.data);
    setAddrs(ad.data || []);
    setContacts(co.data || []);
    setJobs(jb.data || []);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!c) return <p className="muted">Loading customer...</p>;

  const set = (k) => (e) => setC({ ...c, [k]: e.target.value });

  async function saveCustomer(e) {
    e.preventDefault();
    setMsg(null);
    const { id: _id, display_name, created_at, updated_at, ...rest } = c;
    const { error } = await getSupabase().from('customers').update({
      customer_type: rest.customer_type, first_name: rest.first_name, last_name: rest.last_name,
      company_name: rest.company_name, phone: rest.phone, email: rest.email, notes: rest.notes,
    }).eq('id', id);
    setMsg(error ? { err: true, text: error.message.includes('customers_has_name') ? 'Enter a name or a company name.' : error.message } : { text: 'Saved.' });
    if (!error) load();
  }

  async function saveAddress(e) {
    e.preventDefault();
    const { id: aid, customer_id, created_at, ...fields } = editAddr;
    const sb = getSupabase();
    const { error } = aid
      ? await sb.from('addresses').update(fields).eq('id', aid)
      : await sb.from('addresses').insert({ ...fields, customer_id: id });
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setEditAddr(null);
    load();
  }

  async function deleteAddress(a) {
    if (!window.confirm('Delete this address?')) return;
    const { error } = await getSupabase().from('addresses').delete().eq('id', a.id);
    if (error) setMsg({ err: true, text: error.message.includes('foreign key') ? 'This address is used by a job and cannot be deleted.' : error.message });
    else load();
  }

  async function saveContact(e) {
    e.preventDefault();
    const { error } = await getSupabase().from('contacts').insert({ ...newContact, customer_id: id });
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setNewContact(null);
    load();
  }

  async function deleteContact(ct) {
    if (!window.confirm(`Remove ${ct.name}?`)) return;
    await getSupabase().from('contacts').delete().eq('id', ct.id);
    load();
  }

  const setA = (k) => (e) => setEditAddr({ ...editAddr, [k]: e.target.value });
  const setN = (k) => (e) => setNewContact({ ...newContact, [k]: k === 'receives_notifications' ? e.target.checked : e.target.value });

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{c.display_name}</h1>
        <Link href={`/leads/new?customer=${id}`}><button className="primary">New lead</button></Link>
      </div>
      <p className="sub">{c.customer_type}{c.last_visit_at ? ` · last visit ${fmtDateTime(c.last_visit_at)}` : ''}</p>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}

      <form className="card" onSubmit={saveCustomer}>
        <h2>Details</h2>
        <div className="grid2">
          <div className="field"><label>Type</label>
            <select value={c.customer_type} onChange={set('customer_type')}>
              <option value="residential">Residential</option><option value="commercial">Commercial</option><option value="multifamily">Multifamily</option>
            </select>
          </div>
          <div className="field"><label>Company</label><input value={c.company_name} onChange={set('company_name')} /></div>
          <div className="field"><label>First name</label><input value={c.first_name} onChange={set('first_name')} /></div>
          <div className="field"><label>Last name</label><input value={c.last_name} onChange={set('last_name')} /></div>
          <div className="field"><label>Phone</label><PhoneInput value={c.phone} onChange={set('phone')} /></div>
          <div className="field"><label>Email</label><input type="email" value={c.email} onChange={set('email')} /></div>
        </div>
        <div className="field"><label>Notes</label><textarea value={c.notes} onChange={set('notes')} /></div>
        <button className="primary">Save details</button>
      </form>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Service addresses</h2>
          <button className="secondary small" onClick={() => setEditAddr({ ...BLANK_ADDR })}>Add address</button>
        </div>
        <p className="hint">Gate codes and warnings (pets, access) show on every job at the address.</p>
        {addrs.map((a) => (
          <div key={a.id} className="list-item">
            <div className="title">{addressLine(a)}{a.label ? ` (${a.label})` : ''}</div>
            <div className="meta">
              {a.gate_code && <>Gate: {a.gate_code} · </>}{a.access_notes}
            </div>
            {a.warnings && <div className="badge warn">Warning: {a.warnings}</div>}
            <div className="row" style={{ marginTop: 6 }}>
              <button className="secondary small" onClick={() => setEditAddr(a)}>Edit</button>
              <button className="danger small" onClick={() => deleteAddress(a)}>Delete</button>
            </div>
          </div>
        ))}
        {addrs.length === 0 && <p className="muted">No addresses yet.</p>}
        {editAddr && (
          <form onSubmit={saveAddress} style={{ marginTop: 14 }}>
            <AddressFields values={editAddr} onChange={(patch) => setEditAddr({ ...editAddr, ...patch })} required />
            <div className="grid2">
              <div className="field"><label>Label</label><input placeholder="Rental, Office..." value={editAddr.label} onChange={setA('label')} /></div>
              <div className="field"><label>Gate code</label><input value={editAddr.gate_code} onChange={setA('gate_code')} /></div>
            </div>
            <div className="field"><label>Warnings (pets, hazards)</label><input value={editAddr.warnings} onChange={setA('warnings')} /></div>
            <div className="field"><label>Access notes</label><input value={editAddr.access_notes} onChange={setA('access_notes')} /></div>
            <div className="row">
              <button className="primary">Save address</button>
              <button type="button" className="secondary" onClick={() => setEditAddr(null)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Other contacts</h2>
          <button className="secondary small" onClick={() => setNewContact({ ...BLANK_CONTACT })}>Add contact</button>
        </div>
        <p className="hint">Property managers, adjusters, tenants. Add them to a job to send them its notifications.</p>
        {contacts.map((ct) => (
          <div key={ct.id} className="list-item">
            <div className="title">{ct.name} {ct.role && <span className="badge off">{ct.role}</span>}</div>
            <div className="meta">{[displayPhone(ct.phone), ct.email].filter(Boolean).join(' · ')}</div>
            <button className="danger small" style={{ marginTop: 6 }} onClick={() => deleteContact(ct)}>Remove</button>
          </div>
        ))}
        {contacts.length === 0 && <p className="muted">None.</p>}
        {newContact && (
          <form onSubmit={saveContact} style={{ marginTop: 14 }}>
            <div className="grid2">
              <div className="field"><label>Name</label><input required value={newContact.name} onChange={setN('name')} /></div>
              <div className="field"><label>Role</label><input placeholder="Adjuster, manager..." value={newContact.role} onChange={setN('role')} /></div>
              <div className="field"><label>Phone</label><PhoneInput value={newContact.phone} onChange={setN('phone')} /></div>
              <div className="field"><label>Email</label><input type="email" value={newContact.email} onChange={setN('email')} /></div>
            </div>
            <label className="row" style={{ marginBottom: 12 }}>
              <input type="checkbox" checked={newContact.receives_notifications} onChange={setN('receives_notifications')} />
              Receives job notifications when added to a job
            </label>
            <div className="row">
              <button className="primary">Save contact</button>
              <button type="button" className="secondary" onClick={() => setNewContact(null)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <h2>Job history</h2>
        {jobs.map((j) => (
          <Link key={j.id} href={`/jobs/${j.id}`} className="list-item">
            <div className="title">#{j.job_number} <span className={`badge s-${j.status}`}>{JOB_STATUS[j.status]}</span></div>
            <div className="meta">{fmtDateTime(j.created_at)} · {j.address?.street}, {j.address?.city}</div>
          </Link>
        ))}
        {jobs.length === 0 && <p className="muted">No jobs yet.</p>}
      </div>
    </>
  );
}

export default function CustomerPage() {
  const { id } = useParams();
  return <AuthGate officeOnly>{() => <Detail id={id} />}</AuthGate>;
}
