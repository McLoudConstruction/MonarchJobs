'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabaseClient';
import { fromLocalInput, toLocalInput, JOB_TYPES, addressLine, fmtDateTime } from '@/lib/format';

const NEW_CUSTOMER = { customer_type: 'residential', first_name: '', last_name: '', company_name: '', phone: '', email: '' };
const NEW_ADDRESS = { street: '', unit: '', city: '', state: 'MO', zip: '', gate_code: '', warnings: '' };

function defaultStart() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

function BookForm({ staff }) {
  const router = useRouter();
  const params = useSearchParams();
  const leadId = params.get('lead');
  const presetCustomer = params.get('customer');

  const [lead, setLead] = useState(null);
  const [mode, setMode] = useState('existing'); // existing | new
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [customer, setCustomer] = useState(null); // selected existing customer
  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('new');
  const [newCust, setNewCust] = useState(NEW_CUSTOMER);
  const [newAddr, setNewAddr] = useState(NEW_ADDRESS);
  const [job, setJob] = useState({ job_type: 'floor_cleaning', loss_summary: '', warning: '', po_number: '' });
  const [start, setStart] = useState(toLocalInput(defaultStart()));
  const [end, setEnd] = useState(toLocalInput(new Date(defaultStart().getTime() + 2 * 3600 * 1000)));
  const [techId, setTechId] = useState('');
  const [staffList, setStaffList] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [override, setOverride] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const selectCustomer = useCallback(async (c) => {
    setCustomer(c);
    setMode('existing');
    const { data } = await getSupabase().from('addresses').select('*').eq('customer_id', c.id).order('created_at');
    setAddresses(data || []);
    setAddressId(data && data.length ? data[0].id : 'new');
  }, []);

  // staff for the tech picker
  useEffect(() => {
    getSupabase().from('staff_users').select('id,full_name,email,role').eq('active', true).order('email')
      .then(({ data }) => setStaffList(data || []));
  }, []);

  // preset customer or lead
  useEffect(() => {
    const sb = getSupabase();
    if (presetCustomer) {
      sb.from('customers').select('id,display_name').eq('id', presetCustomer).maybeSingle().then(({ data }) => data && selectCustomer(data));
    }
    if (leadId) {
      sb.from('leads').select('*').eq('id', leadId).maybeSingle().then(async ({ data }) => {
        if (!data) return;
        setLead(data);
        setJob((j) => ({ ...j, loss_summary: [data.service_requested, data.notes].filter(Boolean).join(' - ') }));
        if (data.customer_id) {
          const { data: c } = await sb.from('customers').select('id,display_name').eq('id', data.customer_id).maybeSingle();
          if (c) selectCustomer(c);
        } else {
          const [first, ...rest] = (data.name || '').trim().split(/\s+/);
          setMode('new');
          setNewCust({ ...NEW_CUSTOMER, first_name: first || '', last_name: rest.join(' '), phone: data.phone, email: data.email });
          setNewAddr((a) => ({ ...a, street: data.address }));
        }
      });
    }
  }, [leadId, presetCustomer, selectCustomer]);

  // customer search
  useEffect(() => {
    const term = q.trim().replace(/[%,()]/g, ' ');
    if (term.length < 2) { setResults([]); return undefined; }
    const t = setTimeout(async () => {
      const { data } = await getSupabase().from('customers').select('id,display_name,phone')
        .or(`display_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`).eq('archived', false).limit(8);
      setResults(data || []);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  // double-booking check for the chosen tech and time
  useEffect(() => {
    setOverride(false);
    if (!techId || !start || !end || new Date(end) <= new Date(start)) { setConflicts([]); return; }
    getSupabase().from('job_visits')
      .select('id,starts_at,ends_at,status,job:jobs(job_number,customer:customers(display_name))')
      .eq('tech_id', techId).in('status', ['scheduled', 'on_the_way', 'started'])
      .lt('starts_at', fromLocalInput(end)).gt('ends_at', fromLocalInput(start))
      .then(({ data }) => setConflicts(data || []));
  }, [techId, start, end]);

  const setJ = (k) => (e) => setJob({ ...job, [k]: e.target.value });
  const setC = (k) => (e) => setNewCust({ ...newCust, [k]: e.target.value });
  const setA = (k) => (e) => setNewAddr({ ...newAddr, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    if (new Date(end) <= new Date(start)) { setMsg('End time must be after the start time.'); return; }
    if (conflicts.length && !override) { setMsg('This tech is already booked then. Tick the box to book anyway, or pick another time or tech.'); return; }

    setBusy(true);
    const sb = getSupabase();
    try {
      let customerId = customer?.id;
      if (mode === 'new' || !customerId) {
        const { data, error } = await sb.from('customers').insert(newCust).select('id').single();
        if (error) throw new Error(error.message.includes('customers_has_name') ? 'Enter a name or a company name for the customer.' : error.message);
        customerId = data.id;
      }

      let addrId = addressId;
      if (addrId === 'new') {
        if (!newAddr.street.trim()) throw new Error('Enter the service address.');
        const { data, error } = await sb.from('addresses').insert({ ...newAddr, customer_id: customerId }).select('id').single();
        if (error) throw new Error(error.message);
        addrId = data.id;
      }

      const { data: jobRow, error: jerr } = await sb.from('jobs').insert({
        customer_id: customerId, address_id: addrId, lead_id: lead?.id ?? null, created_by: staff.id, ...job,
      }).select('id').single();
      if (jerr) throw new Error(jerr.message);

      const { error: verr } = await sb.from('job_visits').insert({
        job_id: jobRow.id, tech_id: techId || null, starts_at: fromLocalInput(start), ends_at: fromLocalInput(end), created_by: staff.id,
      });
      if (verr) throw new Error(`Job created but the visit failed: ${verr.message}`);

      await sb.from('job_events').insert({
        job_id: jobRow.id, actor_id: staff.id, actor_email: staff.email, kind: 'booked',
        details: { tech_id: techId || null, starts_at: fromLocalInput(start), override_double_booking: conflicts.length > 0 },
      });
      if (lead) await sb.from('leads').update({ status: 'booked', job_id: jobRow.id, customer_id: customerId }).eq('id', lead.id);

      router.push(`/jobs/${jobRow.id}`);
    } catch (err) {
      setMsg(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Book a job</h1>
      <p className="sub">{lead ? `From lead: ${lead.name || lead.phone || lead.email}` : 'Pick or create the customer, then set the time and tech.'}</p>
      <form onSubmit={submit}>
        <div className="card">
          <h2>Customer</h2>
          <div className="tabs">
            <button type="button" className={mode === 'existing' ? 'on' : ''} onClick={() => setMode('existing')}>Existing</button>
            <button type="button" className={mode === 'new' ? 'on' : ''} onClick={() => { setMode('new'); setAddressId('new'); }}>New customer</button>
          </div>
          {mode === 'existing' && (
            <>
              {customer ? (
                <div className="row" style={{ marginBottom: 12 }}>
                  <strong>{customer.display_name}</strong>
                  <button type="button" className="secondary small" onClick={() => { setCustomer(null); setAddresses([]); setAddressId('new'); }}>Change</button>
                </div>
              ) : (
                <div className="field">
                  <input type="search" placeholder="Search by name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} />
                  {results.map((r) => (
                    <div key={r.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => selectCustomer(r)}>
                      <div className="title">{r.display_name}</div><div className="meta">{r.phone}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {mode === 'new' && (
            <div className="grid2">
              <div className="field"><label>Type</label>
                <select value={newCust.customer_type} onChange={setC('customer_type')}>
                  <option value="residential">Residential</option><option value="commercial">Commercial</option><option value="multifamily">Multifamily</option>
                </select>
              </div>
              <div className="field"><label>Company (if any)</label><input value={newCust.company_name} onChange={setC('company_name')} /></div>
              <div className="field"><label>First name</label><input value={newCust.first_name} onChange={setC('first_name')} /></div>
              <div className="field"><label>Last name</label><input value={newCust.last_name} onChange={setC('last_name')} /></div>
              <div className="field"><label>Phone</label><input type="tel" value={newCust.phone} onChange={setC('phone')} /></div>
              <div className="field"><label>Email</label><input type="email" value={newCust.email} onChange={setC('email')} /></div>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Service address</h2>
          {mode === 'existing' && addresses.length > 0 && (
            <div className="field">
              <select value={addressId} onChange={(e) => setAddressId(e.target.value)}>
                {addresses.map((a) => <option key={a.id} value={a.id}>{addressLine(a)}</option>)}
                <option value="new">+ New address</option>
              </select>
            </div>
          )}
          {addressId === 'new' && (
            <>
              <div className="grid2">
                <div className="field"><label>Street</label><input value={newAddr.street} onChange={setA('street')} /></div>
                <div className="field"><label>Unit</label><input value={newAddr.unit} onChange={setA('unit')} /></div>
                <div className="field"><label>City</label><input value={newAddr.city} onChange={setA('city')} /></div>
                <div className="row">
                  <div className="field" style={{ width: 90 }}><label>State</label><input value={newAddr.state} onChange={setA('state')} /></div>
                  <div className="field" style={{ flex: 1 }}><label>ZIP</label><input value={newAddr.zip} onChange={setA('zip')} /></div>
                </div>
                <div className="field"><label>Gate code</label><input value={newAddr.gate_code} onChange={setA('gate_code')} /></div>
                <div className="field"><label>Warnings (pets, hazards)</label><input value={newAddr.warnings} onChange={setA('warnings')} /></div>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>Job</h2>
          <div className="grid2">
            <div className="field"><label>Type</label>
              <select value={job.job_type} onChange={setJ('job_type')}>
                {Object.entries(JOB_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="field"><label>PO number</label><input value={job.po_number} onChange={setJ('po_number')} /></div>
          </div>
          <div className="field"><label>Loss summary for the tech</label><input placeholder="Short blurb: what happened, what to bring" value={job.loss_summary} onChange={setJ('loss_summary')} /></div>
          <div className="field"><label>Job warning (shows as a banner)</label><input value={job.warning} onChange={setJ('warning')} /></div>
        </div>

        <div className="card">
          <h2>When and who</h2>
          <div className="grid2">
            <div className="field"><label>Start</label><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></div>
            <div className="field"><label>End</label><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required /></div>
          </div>
          <div className="field"><label>Tech</label>
            <select value={techId} onChange={(e) => setTechId(e.target.value)}>
              <option value="">Unassigned</option>
              {staffList.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email} ({s.role})</option>)}
            </select>
          </div>
          {conflicts.length > 0 && (
            <div className="banner flag">
              This tech is already booked at that time:
              <ul style={{ margin: '6px 0' }}>
                {conflicts.map((c) => (
                  <li key={c.id}>#{c.job?.job_number} {c.job?.customer?.display_name} ({fmtDateTime(c.starts_at)})</li>
                ))}
              </ul>
              <label className="row"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Book anyway. Both jobs will stay flagged until one is moved.</label>
            </div>
          )}
        </div>

        {msg && <div className="msg err">{msg}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Booking...' : 'Book job'}</button>
      </form>
    </>
  );
}

export default function NewJobPage() {
  return (
    <AuthGate officeOnly>
      {({ staff }) => (
        <Suspense fallback={<p>Loading...</p>}>
          <BookForm staff={staff} />
        </Suspense>
      )}
    </AuthGate>
  );
}
