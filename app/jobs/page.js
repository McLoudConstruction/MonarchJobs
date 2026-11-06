'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabaseClient';
import { JOB_STATUS, JOB_TYPES, fmtDateTime } from '@/lib/format';

const TABS = [
  ['active', 'Active'],
  ['booked', 'Booked'],
  ['in_progress', 'In progress'],
  ['completed', 'Completed'],
  ['closed', 'Closed'],
  ['cancelled', 'Cancelled'],
  ['all', 'All'],
];

function JobsInner({ staff }) {
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const isOffice = staff.role !== 'tech';

  const load = useCallback(async () => {
    let query = getSupabase().from('jobs')
      .select('id,job_number,status,job_type,po_number,customer:customers(display_name),address:addresses(street,city),visits:job_visits(starts_at,status)')
      .order('created_at', { ascending: false }).limit(200);
    if (tab === 'active') query = query.in('status', ['booked', 'on_the_way', 'in_progress']);
    else if (tab === 'in_progress') query = query.in('status', ['on_the_way', 'in_progress']);
    else if (tab !== 'all') query = query.eq('status', tab);
    const { data } = await query;
    setRows(data || []);
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const term = q.trim().toLowerCase();
  const shown = rows.filter((j) => {
    if (!term) return true;
    return [String(j.job_number), j.customer?.display_name, j.address?.street, j.po_number].filter(Boolean).join(' ').toLowerCase().includes(term);
  });

  function nextVisit(j) {
    const upcoming = (j.visits || []).filter((v) => ['scheduled', 'on_the_way', 'started'].includes(v.status)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return upcoming[0]?.starts_at;
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Jobs</h1>
        {isOffice && <Link href="/jobs/new"><button className="primary">Book a job</button></Link>}
      </div>
      <div className="toolbar">
        <input type="search" placeholder="Search job number, customer, street, PO" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tabs">
        {TABS.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <div className="card">
        {shown.length === 0 && <p className="muted">No jobs here.</p>}
        {shown.map((j) => (
          <Link key={j.id} href={`/jobs/${j.id}`} className="list-item">
            <div className="title">#{j.job_number} {j.customer?.display_name} <span className={`badge s-${j.status}`}>{JOB_STATUS[j.status]}</span></div>
            <div className="meta">{JOB_TYPES[j.job_type]} · {j.address?.street}, {j.address?.city}{nextVisit(j) ? ` · next ${fmtDateTime(nextVisit(j))}` : ''}</div>
          </Link>
        ))}
      </div>
    </>
  );
}

export default function JobsPage() {
  return <AuthGate>{({ staff }) => <JobsInner staff={staff} />}</AuthGate>;
}
