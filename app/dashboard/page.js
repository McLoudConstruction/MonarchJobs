'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import ActivityPanel from '@/components/dashboard/ActivityPanel';
import InvoicesPanel from '@/components/dashboard/InvoicesPanel';
import OwnerDashboard from '@/components/owner/OwnerDashboard';
import TimeClockTab from '@/components/owner/TimeClockTab';
import ShiftClock from '@/components/ShiftClock';
import { useNotificationCenter } from '@/lib/useNotifications';
import { useChatCenter } from '@/lib/useChatInbox';
import { useInvoiceFlags } from '@/lib/useInvoiceFlags';
import { tabsFor, parseTab, tabHref, invoiceBadge, legacyOwnerTab, OWNER_TABS } from '@/lib/dashboardTabs';
import { centsToText } from '@/lib/invoice';
import { getSupabase } from '@/lib/supabaseClient';
import { startOfDay, addDays, fmtTime, fmtDateTime, fmtDuration, JOB_TYPES, leadDisplayName } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { doubleBookedIds } from '@/lib/schedule';
import { displayNameFor } from '@/lib/userDisplay';
import '@/components/dashboard/dashboardmobile.css';

function TodayPanel({ staff, activityCount, invoiceFlags }) {
  const isOffice = staff.role !== 'tech';
  const [today, setToday] = useState([]);
  const [newLeads, setNewLeads] = useState([]);
  const [ready, setReady] = useState([]);
  const [unassigned, setUnassigned] = useState({ count: 0, jobIds: [] });
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
      sb.from('job_visits').select('id,job_id', { count: 'exact' }).is('tech_id', null).eq('status', 'scheduled')
        .gte('starts_at', from.toISOString()).limit(200)
        .then(({ data, count }) => setUnassigned({ count: count || 0, jobIds: [...new Set((data || []).map((v) => v.job_id).filter(Boolean))] }));
    }
  }, [isOffice, staff.id]);

  // the visit to do next: the one under way, otherwise the first one still waiting
  const nextVisitId = (today.find((v) => v.status === 'started') || today.find((v) => ['scheduled', 'on_the_way'].includes(v.status)))?.id;

  return (
    <div className="dash-today">
      <ShiftClock staff={staff} />
      <div className="row dash-book" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
        <Link href="/book"><button type="button" className="primary">Book a job</button></Link>
      </div>
      <div className="stat-row">
        <div className="stat-tile stat-visits"><div className="stat-num">{today.length}</div><div className="stat-label">Visits today</div></div>
        {isOffice && <Link href="/leads" className="stat-tile"><div className="stat-num">{ready.length}</div><div className="stat-label">Ready to schedule</div></Link>}
        {isOffice && <Link href="/leads" className="stat-tile"><div className="stat-num">{newLeads.length}</div><div className="stat-label">New leads</div></Link>}
        {/* things that need someone: same tiles, in color */}
        {isOffice && unassigned.count > 0 && (
          <Link href={unassigned.jobIds.length === 1 ? `/jobs/${unassigned.jobIds[0]}` : '/jobs?unassigned=1'} className="stat-tile flag" title="Upcoming visits with no tech assigned">
            <div className="stat-num">{unassigned.count}</div>
            <div className="stat-label">{unassigned.count === 1 ? 'Visit has' : 'Visits have'} no tech{unassigned.jobIds.length === 1 ? ' (open job)' : ''} &rsaquo;</div>
          </Link>
        )}
        {isOffice && flagged > 0 && (
          <div className="stat-tile flag" title="Visits today that overlap for the same tech">
            <div className="stat-num">{flagged}</div>
            <div className="stat-label">{flagged === 1 ? 'Visit overlaps' : 'Visits overlap'} for a tech</div>
          </div>
        )}
        {isOffice && invoiceFlags.pastDue > 0 && (
          <Link href={tabHref('invoices')} className="stat-tile flag">
            <div className="stat-num">{invoiceFlags.pastDue}</div>
            <div className="stat-label">Past due, {centsToText(invoiceFlags.pastDueCents)} owed &rsaquo;</div>
          </Link>
        )}
        {activityCount > 0 && (
          <Link href={tabHref('activity')} className="stat-tile warn">
            <div className="stat-num">{activityCount}</div>
            <div className="stat-label">Unread in Activity &rsaquo;</div>
          </Link>
        )}
      </div>

      <div className="dash-section dash-visits">
        <h3>Today{today.length > 0 && <span className="dash-count">{today.length}</span>}</h3>
        {today.length === 0 && <p className="muted">Nothing scheduled today.</p>}
        {today.map((v) => (
          <Link key={v.id} href={`/jobs/${v.job.id}`} className={`list-item visit-item${v.id === nextVisitId ? ' next' : ''}${['finished'].includes(v.status) ? ' done' : ''}`}>
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
    </div>
  );
}

function DashboardInner({ staff, token }) {
  const isOffice = staff.role !== 'tech';
  const params = useSearchParams();
  const tab = parseTab(params.toString(), staff.role);
  // an old ?tab=owner#financials address moves to its own tab
  useEffect(() => {
    if (params.get('tab') === 'owner') window.history.replaceState(null, '', tabHref(legacyOwnerTab('owner', window.location.hash)));
  }, [params]);
  const { unread } = useNotificationCenter();
  const { unread: chatUnread } = useChatCenter();
  const activityCount = (unread || 0) + (chatUnread || 0);
  const invoiceFlags = useInvoiceFlags();
  const invBadge = isOffice ? invoiceBadge(invoiceFlags) : null;
  const [clockPending, setClockPending] = useState(0);
  useEffect(() => {
    if (staff.role !== 'owner') return undefined;
    const sb = getSupabase();
    let live = true;
    const count = async () => {
      const a = await sb.from('shift_edit_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      if (live) setClockPending(a.count || 0);
    };
    count();
    const t = setInterval(count, 60000);
    return () => { live = false; clearInterval(t); };
  }, [staff.role, tab]);

  const open = (key) => {
    const href = tabHref(key);
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.pushState(null, '', href);
  };

  const badgeFor = (key) => {
    if (key === 'activity' && activityCount > 0) return { count: activityCount, tone: 'accent', title: 'Unread alerts, chats and changes waiting for your OK' };
    if (key === 'invoices') return invBadge;
    if (key === 'timeclock' && clockPending > 0) return { count: clockPending, tone: 'warn', title: `${clockPending} day clock change${clockPending === 1 ? '' : 's'} to approve` };
    return null;
  };

  return (
    <>
      <div className="row dash-head" style={{ justifyContent: 'space-between' }}>
        <h1>{isOffice ? 'Dashboard' : 'My day'}</h1>
        {isOffice && tab === 'today' && (
          <div className="row dash-actions" style={{ gap: 8 }}>
            <Link href="/leads/new"><button type="button" className="primary">Create Lead</button></Link>
            <Link href="/jobs/new"><button type="button" className="secondary">Book Job</button></Link>
          </div>
        )}
      </div>
      <p className="sub dash-welcome">Welcome, {displayNameFor(staff.full_name, staff.email)}.</p>

      <div className="tabs dash-tabs" role="tablist" aria-label="Dashboard sections">
        {tabsFor(staff.role).map((t) => {
          const b = badgeFor(t.key);
          return (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => open(t.key)}>
              {t.label}
              {b && <span className={`tab-count ${b.tone}`} title={b.title} aria-label={b.title}>{b.count > 99 ? '99+' : b.count}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'today' && <TodayPanel staff={staff} activityCount={activityCount} invoiceFlags={invoiceFlags} />}
      {tab === 'activity' && <ActivityPanel staff={staff} token={token} />}
      {tab === 'invoices' && <InvoicesPanel />}
      {OWNER_TABS.includes(tab) && <OwnerDashboard section={tab} />}
      {tab === 'timeclock' && <TimeClockTab />}
    </>
  );
}

export default function DashboardPage() {
  // Suspense because the tab is read from the address (?tab=...)
  return (
    <Suspense fallback={null}>
      <AuthGate>{({ staff, token }) => <DashboardInner staff={staff} token={token} />}</AuthGate>
    </Suspense>
  );
}
