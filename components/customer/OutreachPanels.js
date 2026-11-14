'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';
import { mailingRows, toCsv, MAILING_HEADER } from '@/lib/mailingList';
import { addDays, dateInTz } from '@/lib/outreach';
import { PLAN_INTERVALS } from '@/lib/customerPage';

// Customers list: recurring plans coming due, and a postcard mailing list by months since the last cleaning.
const TYPES = [['residential', 'Residential'], ['commercial', 'Commercial'], ['multifamily', 'Multifamily']];

async function loadAllCustomers() {
  const sb = getSupabase();
  const out = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await sb
      .from('customers')
      .select('id,display_name,customer_type,last_visit_at,marketing_opt_out,archived,addresses(street,unit,city,state,zip,created_at)')
      .eq('archived', false)
      .not('last_visit_at', 'is', null)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  // Postcards are for carpet customers; anyone whose only finished work was restoration is left out.
  const carpet = new Set();
  for (let from = 0; from < 40000; from += 1000) {
    const { data, error } = await sb.from('jobs').select('customer_id').eq('job_type', 'floor_cleaning').in('status', ['completed', 'closed']).order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const j of data || []) carpet.add(j.customer_id);
    if (!data || data.length < 1000) break;
  }
  return out.filter((c) => carpet.has(c.id));
}

export function PlansDue() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || rows) return;
    const limit = addDays(dateInTz(new Date()), 30);
    const { data, error } = await getSupabase()
      .from('service_plans')
      .select('id,name,interval_months,next_due,customer:customers(id,display_name)')
      .eq('status', 'active')
      .lte('next_due', limit)
      .order('next_due');
    if (error) { setErr(error.code === '42P01' ? 'Needs database update 015.' : error.message); return; }
    setRows(data || []);
  }

  const today = dateInTz(new Date());
  return (
    <div style={{ marginBottom: 12 }}>
      <button className="secondary small" onClick={toggle}>{open ? 'Hide plans due' : 'Plans due soon'}</button>
      {open && (
        <div className="card" style={{ marginTop: 8 }}>
          <h2>Plans due in the next 30 days</h2>
          {err && <div className="msg err">{err}</div>}
          {rows && rows.length === 0 && <p className="muted">No plans are due.</p>}
          {(rows || []).map((p) => (
            <div key={p.id} style={{ padding: '4px 0' }}>
              <Link href={`/customers/${p.customer?.id}`}>{p.customer?.display_name}</Link>{' '}
              <span className="muted">{p.name}, {(PLAN_INTERVALS.find(([m]) => m === p.interval_months) || [0, `every ${p.interval_months} months`])[1].toLowerCase()}</span>{' '}
              <strong style={{ color: p.next_due < today ? '#b45309' : undefined }}>{p.next_due < today ? `overdue since ${p.next_due}` : `due ${p.next_due}`}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MailingList() {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('11');
  const [to, setTo] = useState('14');
  const [types, setTypes] = useState(['residential']);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function ensure() {
    if (data) return data;
    setBusy(true); setErr('');
    try { const d = await loadAllCustomers(); setData(d); return d; } catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  }
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) ensure();
  }

  const f = Math.max(0, Number(from) || 0);
  const t = Math.max(f, Number(to) || 0);
  const rows = data ? mailingRows(data, { fromMonths: f, toMonths: t, types }) : [];

  function download() {
    const csv = toCsv(MAILING_HEADER, rows);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mailing-list-${dateInTz(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <button className="secondary small" onClick={toggle}>{open ? 'Hide mailing list' : 'Mailing list'}</button>
      {open && (
        <div className="card" style={{ marginTop: 8 }}>
          <h2>Postcard mailing list</h2>
          <p className="hint">Past carpet customers last serviced between these ages. Customers marked “no reminders or mailings” and customers with no street address are left out.</p>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ width: 130, marginBottom: 0 }}><label>From months ago</label><input type="number" min="0" max="120" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="field" style={{ width: 130, marginBottom: 0 }}><label>To months ago</label><input type="number" min="0" max="120" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          <div className="row" style={{ margin: '10px 0' }}>
            {TYPES.map(([k, l]) => (
              <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={types.includes(k)} onChange={(e) => setTypes(e.target.checked ? [...types, k] : types.filter((x) => x !== k))} /> {l}
              </label>
            ))}
          </div>
          {err && <div className="msg err">{err}</div>}
          <div className="row" style={{ alignItems: 'center' }}>
            <strong>{busy ? 'Loading...' : `${rows.length} customer${rows.length === 1 ? '' : 's'}`}</strong>
            <button className="primary small" disabled={!rows.length} onClick={download}>Download CSV</button>
          </div>
        </div>
      )}
    </div>
  );
}
