'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabaseClient';
import PhoneInput from '@/components/PhoneInput';
import { CUSTOMER_TYPES } from '@/lib/format';
import { displayPhone, formatPhone, digitsOnly } from '@/lib/phone';

const EMPTY = {
  customer_type: 'residential', first_name: '', last_name: '', company_name: '', phone: '', email: '',
  street: '', unit: '', city: '', state: 'MO', zip: '',
};

function CustomersInner() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cf, setCf] = useState({ name: '', type: '', phone: '', email: '', last: '' }); // per-column filters
  const [sort, setSort] = useState({ key: 'name', dir: 1 });

  const load = useCallback(async () => {
    let query = getSupabase()
      .from('customers')
      .select('id,display_name,customer_type,phone,email,last_visit_at')
      .eq('archived', false)
      .order('display_name')
      .limit(1000);
    const term = q.trim().replace(/[%,()]/g, ' ');
    if (term) {
      // digits typed as 816555 also match phones stored as (816) 555-1212
      const formatted = digitsOnly(term).length >= 3 && /^[\d\s().+-]+$/.test(term) ? `,phone.ilike."%${formatPhone(term)}%"` : '';
      query = query.or(`display_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%${formatted}`);
    }
    const { data } = await query;
    setRows(data || []);
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const shown = useMemo(() => {
    const has = (v, t) => !t.trim() || String(v || '').toLowerCase().includes(t.trim().toLowerCase());
    const phoneHas = (v, t) => !t.trim() || displayPhone(v).includes(t.trim()) || digitsOnly(v).includes(digitsOnly(t));
    const lastTxt = (c) => (c.last_visit_at ? new Date(c.last_visit_at).toLocaleDateString() : '');
    const out = rows.filter((c) => has(c.display_name, cf.name) && (!cf.type || c.customer_type === cf.type)
      && (!cf.phone.trim() || phoneHas(c.phone, cf.phone)) && has(c.email, cf.email) && has(lastTxt(c), cf.last));
    const val = { name: (c) => (c.display_name || '').toLowerCase(), type: (c) => c.customer_type || '', phone: (c) => digitsOnly(c.phone), email: (c) => (c.email || '').toLowerCase(), last: (c) => c.last_visit_at || '' }[sort.key];
    return out.sort((a, b) => (val(a) < val(b) ? -sort.dir : val(a) > val(b) ? sort.dir : 0));
  }, [rows, cf, sort]);
  const anyFilter = Object.values(cf).some((v) => v);
  const head = (key, label) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => setSort({ key, dir: sort.key === key ? -sort.dir : 1 })}>{label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button>
    </th>
  );
  const fi = (key) => <input aria-label={`Filter ${key}`} placeholder="Filter" value={cf[key]} onChange={(e) => setCf({ ...cf, [key]: e.target.value })} />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = getSupabase();
    const { street, unit, city, state, zip, ...cust } = form;
    const { data: c, error } = await sb.from('customers').insert(cust).select('id').single();
    if (error) {
      setBusy(false);
      setMsg(error.message.includes('customers_has_name') ? 'Enter a name or a company name.' : error.message);
      return;
    }
    if (street.trim()) {
      const { error: aerr } = await sb.from('addresses').insert({ customer_id: c.id, street, unit, city, state, zip });
      if (aerr) setMsg(`Customer saved, address failed: ${aerr.message}`);
    }
    setBusy(false);
    router.push(`/customers/${c.id}`);
  }

  return (
    <>
      <h1>Customers</h1>
      <p className="sub">Search everything, or filter under any column heading. Click a heading to sort.</p>
      <div className="toolbar">
        <input type="search" placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="primary" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'New customer'}</button>
      </div>

      {adding && (
        <form className="card" onSubmit={create}>
          <h2>New customer</h2>
          <div className="grid2">
            <div className="field"><label>Type</label>
              <select value={form.customer_type} onChange={set('customer_type')}>
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
                <option value="multifamily">Multifamily</option>
              </select>
            </div>
            <div className="field"><label>Company (if any)</label><input value={form.company_name} onChange={set('company_name')} /></div>
            <div className="field"><label>First name</label><input value={form.first_name} onChange={set('first_name')} /></div>
            <div className="field"><label>Last name</label><input value={form.last_name} onChange={set('last_name')} /></div>
            <div className="field"><label>Phone</label><PhoneInput value={form.phone} onChange={set('phone')} /></div>
            <div className="field"><label>Email</label><input type="email" value={form.email} onChange={set('email')} /></div>
          </div>
          <h2 style={{ marginTop: 8 }}>First service address (optional)</h2>
          <div className="grid2">
            <div className="field"><label>Street</label><input value={form.street} onChange={set('street')} /></div>
            <div className="field"><label>Unit</label><input value={form.unit} onChange={set('unit')} /></div>
            <div className="field"><label>City</label><input value={form.city} onChange={set('city')} /></div>
            <div className="row">
              <div className="field" style={{ width: 90 }}><label>State</label><input value={form.state} onChange={set('state')} /></div>
              <div className="field" style={{ flex: 1 }}><label>ZIP</label><input value={form.zip} onChange={set('zip')} /></div>
            </div>
          </div>
          {msg && <div className="msg err">{msg}</div>}
          <button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save customer'}</button>
        </form>
      )}

      <div className="data-table-wrap">
        <table className="data-table cust-table">
          <thead>
            <tr>{head('name', 'Name')}{head('type', 'Type')}{head('phone', 'Phone')}{head('email', 'Email')}{head('last', 'Last visit')}</tr>
            <tr className="filter-row">
              <th>{fi('name')}</th>
              <th>
                <select aria-label="Filter type" value={cf.type} onChange={(e) => setCf({ ...cf, type: e.target.value })}>
                  <option value="">All</option>
                  {Object.entries(CUSTOMER_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </th>
              <th>{fi('phone')}</th>
              <th>{fi('email')}</th>
              <th>{fi('last')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={5} className="muted" style={{ cursor: 'default' }}>No customers found.</td></tr>}
            {shown.map((c) => (
              <tr key={c.id} tabIndex={0} onClick={() => router.push(`/customers/${c.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/customers/${c.id}`); }}>
                <td><Link href={`/customers/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.display_name}</Link></td>
                <td>{CUSTOMER_TYPES[c.customer_type] || c.customer_type}</td>
                <td>{displayPhone(c.phone)}</td>
                <td>{c.email}</td>
                <td>{c.last_visit_at ? new Date(c.last_visit_at).toLocaleDateString() : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{anyFilter ? `${shown.length} of ${rows.length} shown. ` : `${rows.length} customers${rows.length >= 1000 ? ' (first 1000, use search to narrow)' : ''}. `}{anyFilter && <button type="button" className="secondary small" onClick={() => setCf({ name: '', type: '', phone: '', email: '', last: '' })}>Clear filters</button>}</p>
    </>
  );
}

export default function CustomersPage() {
  return <AuthGate officeOnly>{() => <CustomersInner />}</AuthGate>;
}
