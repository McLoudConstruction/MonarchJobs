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
  const [noTech, setNoTech] = useState(false); // from the dashboard banner: jobs with an upcoming visit that has no tech
  const isOffice = staff.role !== 'tech';
  // Techs start on the jobs they are scheduled on; "All jobs" is the way into any other job, just in case.
  const [scope, setScope] = useState(isOffice ? 'all' : 'mine');

  const mineOnly = !isOffice && scope === 'mine';

  const load = useCallback(async () => {
    // a tech's "My jobs" asks the database for only the jobs they have a visit on, so the 200-row limit never hides one of theirs
    let query = getSupabase().from('jobs')
      .select(`id,job_number,status,job_type,po_number,customer:customers(display_name),address:addresses(street,city),visits:job_visits${mineOnly ? '!inner' : ''}(starts_at,status,tech_id)`)
      .order('created_at', { ascending: false }).limit(200);
    if (mineOnly) query = query.eq('visits.tech_id', staff.id);
    if (tab === 'active') query = query.in('status', ['booked', 'on_the_way', 'in_progress']);
    else if (tab === 'in_progress') query = query.in('status', ['on_the_way', 'in_progress']);
    else if (tab !== 'all') query = query.eq('status', tab);
    const { data } = await query;
    setRows(data || []);
  }, [tab, mineOnly, staff.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('unassigned')) { setNoTech(true); setTab('active'); }
  }, []);

  const term = q.trim().toLowerCase();
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
  const shown = rows.filter((j) => {
    if (mineOnly && !(j.visits || []).some((v) => v.tech_id === staff.id)) return false;
    if (noTech && !(j.visits || []).some((v) => v.status === 'scheduled' && !v.tech_id && new Date(v.starts_at) >= startOfToday)) return false;
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
      {!isOffice && (
        <div className="seg" role="group" aria-label="Which jobs">
          <button type="button" className={scope === 'mine' ? 'on' : ''} aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>My jobs</button>
          <button type="button" className={scope === 'all' ? 'on' : ''} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All jobs</button>
        </div>
      )}
      <div className="toolbar">
        <input type="search" placeholder="Search job number, customer, street, PO" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {noTech && (
        <div className="banner flag" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span>Showing jobs with an upcoming visit that has no tech assigned.</span>
          <button className="secondary small" onClick={() => { setNoTech(false); window.history.replaceState(null, '', '/jobs'); }}>Show all</button>
        </div>
      )}
      <div className="tabs">
        {TABS.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <div className="list-stack">
        {shown.length === 0 && <p className="muted">{!isOffice && scope === 'mine' ? 'No jobs are scheduled for you here. Tap All jobs to look at any other job.' : 'No jobs here.'}</p>}
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
