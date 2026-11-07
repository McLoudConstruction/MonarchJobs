'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabaseClient';
import PhoneInput from '@/components/PhoneInput';
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

  const load = useCallback(async () => {
    let query = getSupabase()
      .from('customers')
      .select('id,display_name,customer_type,phone,email,last_visit_at')
      .eq('archived', false)
      .order('display_name')
      .limit(200);
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
      <p className="sub">Search by name, phone or email.</p>
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

      <div className="card">
        {rows.length === 0 && <p className="muted">No customers found.</p>}
        {rows.map((c) => (
          <Link key={c.id} href={`/customers/${c.id}`} className="list-item">
            <div className="title">{c.display_name} <span className="badge off">{c.customer_type}</span></div>
            <div className="meta">{[displayPhone(c.phone), c.email].filter(Boolean).join(' · ')}</div>
          </Link>
        ))}
      </div>
    </>
  );
}

export default function CustomersPage() {
  return <AuthGate officeOnly>{() => <CustomersInner />}</AuthGate>;
}
