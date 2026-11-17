'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';
import { agingTotals, AGING, invoiceChip, isPastDue, centsToText, daysPastDue } from '@/lib/invoice';
import '@/components/job/invoice.css';
import '@/components/owner/owner.css';

const FILTERS = [
  ['open', 'Owed'],
  ['past', 'Past due'],
  ['draft', 'Drafts'],
  ['paid', 'Paid'],
  ['void', 'Void'],
  ['all', 'All'],
];

const matches = (f, i) => ({
  open: i.status === 'sent' || i.status === 'partial',
  past: isPastDue(i),
  draft: i.status === 'draft',
  paid: i.status === 'paid',
  void: i.status === 'void',
  all: true,
}[f]);

// Every invoice in one place: what is owed and how late, drafts waiting to be sent, and what was paid.
export default function InvoicesPanel() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('open');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    getSupabase().from('invoices')
      .select('id,invoice_number,job_id,kind,status,total_cents,balance_cents,paid_cents,due_date,issued_at,paid_at,created_at,job:jobs(job_number,customer:customers(display_name))')
      .order('created_at', { ascending: false }).limit(1000)
      .then(({ data, error }) => { if (error) setErr(/invoices/.test(error.message) ? 'Run the latest database update first (migration 019).' : error.message); else setRows(data || []); });
  }, []);

  const aging = useMemo(() => agingTotals(rows || []), [rows]);
  const drafts = (rows || []).filter((i) => i.status === 'draft').length;
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || []).filter((i) => matches(filter, i)).filter((i) => !needle || `${i.invoice_number} ${i.job?.job_number} ${i.job?.customer?.display_name}`.toLowerCase().includes(needle))
      .sort((a, b) => (filter === 'open' || filter === 'past' ? String(a.due_date).localeCompare(String(b.due_date)) : 0));
  }, [rows, filter, q]);

  return (
    <>
      <p className="sub">What customers owe, how late it is, and drafts waiting to be sent.</p>
      {err && <div className="msg err">{err}</div>}
      {!rows && !err && <p className="muted">Loading...</p>}
      {rows && (
        <>
          <div className="own-tiles">
            <div className="own-tile"><div className="num">{centsToText(aging.total)}</div><div className="lab">Total owed</div></div>
            {AGING.map((a) => (
              <div className="own-tile" key={a.key}>
                <div className="num" style={{ color: a.key !== 'current' && aging[a.key] > 0 ? '#8a1f14' : undefined }}>{centsToText(aging[a.key])}</div>
                <div className="lab">{a.label}</div>
              </div>
            ))}
            <div className="own-tile"><div className="num">{drafts}</div><div className="lab">Drafts to send</div></div>
          </div>
          <div className="card">
            <div className="inv-pick">
              {FILTERS.map(([k, label]) => <button key={k} type="button" className={`secondary ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label} ({rows.filter((i) => matches(k, i)).length})</button>)}
            </div>
            <div className="field"><input placeholder="Search by customer, job or invoice number" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            {list.map((i) => { const c = invoiceChip(i); return (
              <Link key={i.id} href={`/jobs/${i.job_id}#invoice`} className="list-item" style={{ display: 'block' }}>
                <div className="title">#{i.invoice_number} · {i.job?.customer?.display_name || 'Customer'} <span className={`inv-chip ${c.tone}`}>{c.label}</span></div>
                <div className="meta">
                  Job #{i.job?.job_number} · {centsToText(i.total_cents)} total
                  {i.status === 'sent' || i.status === 'partial' ? ` · ${centsToText(i.balance_cents)} owed${i.due_date ? ` · due ${i.due_date}` : ''}${isPastDue(i) ? ` (${daysPastDue(i)} days late)` : ''}` : ''}
                  {i.kind === 'difference' ? ' · return visit' : ''}
                </div>
              </Link>); })}
            {list.length === 0 && <p className="muted">Nothing here.</p>}
          </div>
        </>
      )}
    </>
  );
}
