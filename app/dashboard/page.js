'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabaseClient';
import { startOfDay, addDays, fmtTime, fmtDateTime, fmtDuration, JOB_TYPES, leadDisplayName } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { doubleBookedIds } from '@/lib/schedule';
import { displayNameFor } from '@/lib/userDisplay';

function DashboardInner({ staff }) {
  const isOffice = staff.role !== 'tech';
  const [today, setToday] = useState([]);
  const [newLeads, setNewLeads] = useState([]);
  const [ready, setReady] = useState([]);
  const [unassigned, setUnassigned] = useState(0);
  const [flagged, setFlagged] = useState(0);

  useEffect(() => {
    const sb = getSupabase();
    const from = startOfDay(new Date());
    const to = addDays(from, 1);
    sb.from('job_visits')
      .select('id,tech_id,starts_at,ends_at,duration_minutes,status,job:jobs(id,job_number,job_type,loss_summary,customer:customers(display_name),address:addresses(street,city,gate_code))')
      .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).neq('status', 'cancelled').order('starts_at')
      .then(({ data }) => {
        const all = data || [];
        setToday(isOffice ? all : all.filter((v) => v.tech_id === staff.id));
        setFlagged(doubleBookedIds(all).size);
      });
    if (isOffice) {
      sb.from('leads').select('id,name,first_name,last_name,company_name,phone,service_requested,created_at').eq('status', 'new').order('created_at', { ascending: false }).limit(5)
        .then(({ data }) => setNewLeads(data || []));
      sb.from('leads').select('id,name,first_name,last_name,company_name,phone,service_requested,accepted_at,preferred_times').eq('status', 'accepted').order('accepted_at').limit(10)
        .then(({ data }) => setReady(data || []));
      sb.from('job_visits').select('id', { count: 'exact', head: true }).is('tech_id', null).eq('status', 'scheduled')
        .gte('starts_at', from.toISOString()).then(({ count }) => setUnassigned(count || 0));
    }
  }, [isOffice, staff.id]);

  return (
    <>
      <h1>{isOffice ? 'Dashboard' : 'My day'}</h1>
      <p className="sub">Welcome, {displayNameFor(staff.full_name, staff.email)}.</p>

      <div className="stat-row">
        <div className="stat-tile"><div className="stat-num">{today.length}</div><div className="stat-label">Visits today</div></div>
        {isOffice && <Link href="/leads" className="stat-tile"><div className="stat-num">{ready.length}</div><div className="stat-label">Ready to schedule</div></Link>}
        {isOffice && <Link href="/leads" className="stat-tile"><div className="stat-num">{newLeads.length}</div><div className="stat-label">New leads</div></Link>}
      </div>

      {isOffice && (flagged > 0 || unassigned > 0) && (
        <div className="banner flag">
          {flagged > 0 && <div>{flagged} visits today overlap for the same tech.</div>}
          {unassigned > 0 && <div>{unassigned} upcoming visits have no tech assigned.</div>}
        </div>
      )}

      <div className="dash-section">
        <h3>Today</h3>
        {today.length === 0 && <p className="muted">Nothing scheduled today.</p>}
        {today.map((v) => (
          <Link key={v.id} href={`/jobs/${v.job.id}`} className="list-item">
            <div className="title">{fmtTime(v.starts_at)} · {fmtDuration(v.duration_minutes)} · #{v.job.job_number} {v.job.customer?.display_name}</div>
            <div className="meta">{JOB_TYPES[v.job.job_type]} · {v.job.address?.street}, {v.job.address?.city}</div>
            {v.job.loss_summary && <div className="meta">{v.job.loss_summary}</div>}
          </Link>
        ))}
      </div>

      {isOffice && ready.length > 0 && (
        <div className="dash-section">
          <h3 className="dash-section-heading-rust">Ready to schedule</h3>
          <p className="hint">These customers approved their estimate. Pick a time and create the work order.</p>
          {ready.map((l) => (
            <Link key={l.id} href={`/leads/${l.id}`} className="list-item">
              <div className="title">{leadDisplayName(l) || displayPhone(l.phone)}</div>
              <div className="meta">{l.service_requested} · approved {fmtDateTime(l.accepted_at)}</div>
              {l.preferred_times && <div className="meta">Preferred times: {l.preferred_times}</div>}
            </Link>
          ))}
        </div>
      )}

      {isOffice && (
        <div className="dash-section">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>New leads</h3>
            <Link href="/leads"><button className="secondary small">All leads</button></Link>
          </div>
          {newLeads.length === 0 && <p className="muted">No new leads.</p>}
          {newLeads.map((l) => (
            <Link key={l.id} href={`/leads/${l.id}`} className="list-item">
              <div className="title">{leadDisplayName(l) || displayPhone(l.phone)}</div>
              <div className="meta">{l.service_requested} · {fmtDateTime(l.created_at)}</div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export default function DashboardPage() {
  return <AuthGate>{({ staff }) => <DashboardInner staff={staff} />}</AuthGate>;
}
