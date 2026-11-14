'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { fmtDateTime, money, addressLine } from '@/lib/format';
import { addMonths, dateInTz, KIND_LABELS } from '@/lib/outreach';
import { PLAN_INTERVALS } from '@/lib/customerPage';

const PLAN_STATUS = { active: 'Active', paused: 'Paused', ended: 'Ended' };

// Customer page, office side: recurring plans, "no reminders or mailings", and what we have sent them.
export default function PlansCard({ customer, addresses, onChanged }) {
  const [plans, setPlans] = useState(null);
  const [log, setLog] = useState([]);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [{ data: p, error }, { data: l }] = await Promise.all([
      sb.from('service_plans').select('*').eq('customer_id', customer.id).order('created_at', { ascending: false }),
      sb.from('outreach_log').select('kind,at,results').eq('customer_id', customer.id).order('at', { ascending: false }).limit(10),
    ]);
    if (error) { setPlans(false); return; } // migration 015 not run yet
    setPlans(p || []);
    setLog(l || []);
  }, [customer.id]);
  useEffect(() => { load(); }, [load]);

  if (plans === null) return null;
  if (plans === false) return null;

  const startForm = () => {
    const today = dateInTz(new Date());
    setForm({ name: 'Regular carpet cleaning', interval_months: '3', price: '', note: '', address_id: addresses[0]?.id || '', next_due: addMonths(today, 3) });
  };
  const setInterval = (m) => {
    const base = customer.last_visit_at ? dateInTz(customer.last_visit_at) : dateInTz(new Date());
    setForm((f) => ({ ...f, interval_months: m, next_due: addMonths(base, Number(m)) }));
  };

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    const price = form.price === '' ? null : Number(form.price);
    if (!form.name.trim() || (price !== null && !(price >= 0)) || !/^\d{4}-\d{2}-\d{2}$/.test(form.next_due)) { setMsg({ err: true, text: 'Enter a name, a valid price (or none) and the next date.' }); return; }
    const { error } = await getSupabase().from('service_plans').insert({
      customer_id: customer.id, address_id: form.address_id || null, name: form.name.trim(), interval_months: Number(form.interval_months),
      price, note: form.note.trim(), next_due: form.next_due,
    });
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setForm(null); load();
  }

  async function setStatus(p, status) {
    const patch = { status, ...(status === 'ended' ? { ended_at: new Date().toISOString() } : { ended_at: null }) };
    await getSupabase().from('service_plans').update(patch).eq('id', p.id);
    load();
  }
  async function setDue(p, next_due) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next_due)) return;
    await getSupabase().from('service_plans').update({ next_due }).eq('id', p.id);
    load();
  }
  async function toggleOptOut(e) {
    await getSupabase().from('customers').update({ marketing_opt_out: e.target.checked }).eq('id', customer.id);
    onChanged?.();
  }

  const addrFor = (id) => { const a = addresses.find((x) => x.id === id); return a ? addressLine(a) : ''; };

  return (
    <div className="card">
      <h2>Regular plans and reminders</h2>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={!!customer.marketing_opt_out} onChange={toggleOptOut} />
        No reminders or mailings for this customer
      </label>

      {plans.map((p) => (
        <div key={p.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
          <strong>{p.name}</strong> <span className={`badge ${p.status === 'active' ? 's-completed' : 'off'}`}>{PLAN_STATUS[p.status]}</span>
          <div className="muted">
            {(PLAN_INTERVALS.find(([m]) => m === p.interval_months) || [0, `Every ${p.interval_months} months`])[1]}
            {p.price != null ? ` · ${money(p.price)}` : ''}{p.address_id ? ` · ${addrFor(p.address_id)}` : ''}
          </div>
          {p.note && <div className="muted">{p.note}</div>}
          {p.status !== 'ended' && (
            <div className="row" style={{ marginTop: 6, alignItems: 'center' }}>
              <label className="muted">Next due <input type="date" defaultValue={p.next_due} onBlur={(e) => e.target.value !== p.next_due && setDue(p, e.target.value)} /></label>
              {p.status === 'active' ? <button className="secondary small" onClick={() => setStatus(p, 'paused')}>Pause</button> : <button className="secondary small" onClick={() => setStatus(p, 'active')}>Resume</button>}
              <button className="danger small" onClick={() => window.confirm('End this plan?') && setStatus(p, 'ended')}>End</button>
            </div>
          )}
        </div>
      ))}
      {plans.length === 0 && !form && <p className="muted">No plan yet.</p>}

      {form ? (
        <form onSubmit={save} style={{ marginTop: 10 }}>
          <div className="grid2">
            <div className="field"><label>Plan name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>How often</label>
              <select value={form.interval_months} onChange={(e) => setInterval(e.target.value)}>
                {PLAN_INTERVALS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
              </select>
            </div>
            <div className="field"><label>Price per visit (optional)</label><input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
            <div className="field"><label>Next visit due</label><input type="date" value={form.next_due} onChange={(e) => setForm({ ...form, next_due: e.target.value })} /></div>
            <div className="field"><label>Address</label>
              <select value={form.address_id} onChange={(e) => setForm({ ...form, address_id: e.target.value })}>
                <option value="">Any</option>
                {addresses.map((a) => <option key={a.id} value={a.id}>{addressLine(a)}</option>)}
              </select>
            </div>
            <div className="field"><label>Note (optional)</label><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          </div>
          <div className="row"><button className="primary">Save plan</button><button type="button" className="secondary" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      ) : <button className="secondary small" style={{ marginTop: 8 }} onClick={startForm}>+ Add a plan</button>}

      {log.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <strong>Reminders sent</strong>
          <ul style={{ paddingLeft: 18, margin: '4px 0 0' }}>
            {log.map((l, i) => <li key={i}>{KIND_LABELS[l.kind]}, {fmtDateTime(l.at)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
