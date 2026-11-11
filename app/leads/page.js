'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabaseClient';
import { fmtDateTime, LEAD_STATUS, JOB_TYPES, leadDisplayName } from '@/lib/format';
import { displayPhone, formatPhone, digitsOnly } from '@/lib/phone';
import { PRIORITIES, RESTORATION_TYPES } from '@/lib/leadIntake';

const TABS = [
  ['open', 'Open'],
  ['accepted', 'Ready to schedule'],
  ['booked', 'Work orders'],
  ['lost', 'Lost'],
];

function LeadsInner() {
  const [tab, setTab] = useState('open');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});

  const load = useCallback(async () => {
    const sb = getSupabase();
    let query = sb.from('leads')
      .select('id,status,source,name,first_name,last_name,company_name,phone,email,address,job_type,restoration_type,priority,service_requested,created_at,accepted_at,job_id,preferred_times')
      .order(tab === 'accepted' ? 'accepted_at' : 'created_at', { ascending: tab === 'accepted' })
      .limit(200);
    query = tab === 'open' ? query.in('status', ['new', 'quoted']) : query.eq('status', tab);
    const term = q.trim().replace(/[%,()]/g, ' ');
    if (term) {
      const formatted = digitsOnly(term).length >= 3 && /^[\d\s().+-]+$/.test(term) ? `,phone.ilike."%${formatPhone(term)}%"` : '';
      query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,address.ilike.%${term}%${formatted}`);
    }
    const { data } = await query;
    setRows(data || []);
  }, [tab, q]);

  useEffect(() => { const t = setTimeout(load, 150); return () => clearTimeout(t); }, [load]);

  useEffect(() => {
    getSupabase().from('leads').select('status').in('status', ['new', 'quoted', 'accepted']).then(({ data }) => {
      const c = { open: 0, accepted: 0 };
      for (const r of data || []) c[r.status === 'accepted' ? 'accepted' : 'open'] += 1;
      setCounts(c);
    });
  }, [rows.length]);

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Leads</h1>
        <Link href="/leads/new"><button className="primary">New lead</button></Link>
      </div>
      <p className="sub">Every job starts as a lead. Add the estimate, get it approved, pick a time, then create the work order.</p>

      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}{counts[k] ? ` (${counts[k]})` : ''}
          </button>
        ))}
      </div>
      <div className="toolbar"><input type="search" placeholder="Search name, phone, email or address" value={q} onChange={(e) => setQ(e.target.value)} /></div>

      <div className="list-stack">
        {rows.length === 0 && <p className="muted">No leads here.</p>}
        {rows.map((l) => (
          <Link key={l.id} href={l.status === 'booked' && l.job_id ? `/jobs/${l.job_id}` : `/leads/${l.id}`} className="list-item">
            <div className="title">
              {leadDisplayName(l) || displayPhone(l.phone) || l.email || 'Unnamed lead'}{' '}
              <span className={`badge s-${l.status}`}>{LEAD_STATUS[l.status]}</span>{' '}
              <span className="badge off">{l.restoration_type ? RESTORATION_TYPES[l.restoration_type].label : JOB_TYPES[l.job_type]}</span>{' '}
              {l.priority && l.priority !== 'standard' && ['new', 'quoted'].includes(l.status) && <span className={`badge prio-${l.priority}`}>{PRIORITIES[l.priority]}</span>}
            </div>
            <div className="meta">{[displayPhone(l.phone), l.email, l.address].filter(Boolean).join(' · ')}</div>
            {l.service_requested && <div>{l.service_requested}</div>}
            {l.status === 'accepted' && l.preferred_times && <div className="meta">Customer's preferred times: {l.preferred_times}</div>}
            <div className="meta">
              {l.status === 'accepted' ? `Accepted ${fmtDateTime(l.accepted_at)}` : `Added ${fmtDateTime(l.created_at)}`}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

export default function LeadsPage() {
  return <AuthGate officeOnly>{() => <LeadsInner />}</AuthGate>;
}
