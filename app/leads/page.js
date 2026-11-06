'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabaseClient';
import { fmtDateTime } from '@/lib/format';

const TABS = [
  ['open', 'Open'],
  ['new', 'New'],
  ['quoted', 'Quoted'],
  ['booked', 'Booked'],
  ['lost', 'Lost'],
];
const BLANK = { source: 'phone', name: '', phone: '', email: '', address: '', service_requested: '', notes: '' };

function LeadsInner({ staff }) {
  const [tab, setTab] = useState('open');
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    let q = getSupabase().from('leads').select('*').order('created_at', { ascending: false }).limit(200);
    if (tab === 'open') q = q.in('status', ['new', 'quoted']);
    else q = q.eq('status', tab);
    const { data } = await q;
    setRows(data || []);
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function create(e) {
    e.preventDefault();
    if (!form.name.trim() && !form.phone.trim() && !form.email.trim()) {
      setMsg('Enter at least a name, phone or email.');
      return;
    }
    const { error } = await getSupabase().from('leads').insert({ ...form, created_by: staff.id });
    if (error) { setMsg(error.message); return; }
    setForm(BLANK);
    setAdding(false);
    setMsg(null);
    load();
  }

  async function setStatus(lead, status, extra = {}) {
    const { error } = await getSupabase().from('leads').update({ status, ...extra }).eq('id', lead.id);
    if (error) setMsg(error.message);
    else load();
  }

  async function markLost(lead) {
    const reason = window.prompt('Why was this lead lost? (optional)') ?? null;
    if (reason === null) return;
    setStatus(lead, 'lost', { lost_reason: reason });
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Leads</h1>
        <button className="primary" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'New lead'}</button>
      </div>
      <p className="sub">Every contact is a lead until a job is booked. Website form submissions will arrive here too.</p>
      {msg && <div className="msg err">{msg}</div>}

      {adding && (
        <form className="card" onSubmit={create}>
          <h2>Log a lead</h2>
          <div className="grid2">
            <div className="field"><label>Name</label><input value={form.name} onChange={set('name')} /></div>
            <div className="field"><label>Source</label>
              <select value={form.source} onChange={set('source')}>
                <option value="phone">Phone call</option><option value="web">Website</option>
                <option value="referral">Referral</option><option value="manual">Other</option>
              </select>
            </div>
            <div className="field"><label>Phone</label><input type="tel" value={form.phone} onChange={set('phone')} /></div>
            <div className="field"><label>Email</label><input type="email" value={form.email} onChange={set('email')} /></div>
          </div>
          <div className="field"><label>Address</label><input value={form.address} onChange={set('address')} /></div>
          <div className="field"><label>Service requested</label><input placeholder="Carpet cleaning, water in kitchen..." value={form.service_requested} onChange={set('service_requested')} /></div>
          <div className="field"><label>Notes</label><textarea value={form.notes} onChange={set('notes')} /></div>
          <button className="primary">Save lead</button>
        </form>
      )}

      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      <div className="card">
        {rows.length === 0 && <p className="muted">No leads here.</p>}
        {rows.map((l) => (
          <div key={l.id} className="list-item">
            <div className="title">
              {l.name || l.phone || l.email} <span className={`badge s-${l.status}`}>{l.status}</span>{' '}
              <span className="badge off">{l.source}</span>
            </div>
            <div className="meta">{[l.phone, l.email, l.address].filter(Boolean).join(' · ')}</div>
            {l.service_requested && <div>{l.service_requested}</div>}
            {l.notes && <div className="meta">{l.notes}</div>}
            {l.status === 'lost' && l.lost_reason && <div className="meta">Lost: {l.lost_reason}</div>}
            <div className="meta">{fmtDateTime(l.created_at)}</div>
            <div className="row" style={{ marginTop: 6 }}>
              {l.status !== 'booked' && l.status !== 'lost' && (
                <Link href={`/jobs/new?lead=${l.id}`}><button className="primary small">Book job</button></Link>
              )}
              {l.status === 'new' && <button className="secondary small" onClick={() => setStatus(l, 'quoted')}>Mark quoted</button>}
              {(l.status === 'new' || l.status === 'quoted') && <button className="danger small" onClick={() => markLost(l)}>Lost</button>}
              {l.status === 'lost' && <button className="secondary small" onClick={() => setStatus(l, 'new', { lost_reason: '' })}>Reopen</button>}
              {l.status === 'booked' && l.job_id && <Link href={`/jobs/${l.job_id}`}><button className="secondary small">Open job</button></Link>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function LeadsPage() {
  return <AuthGate officeOnly>{({ staff }) => <LeadsInner staff={staff} />}</AuthGate>;
}
