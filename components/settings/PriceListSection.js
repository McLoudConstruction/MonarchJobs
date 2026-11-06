'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { money, UNIT_LABELS } from '@/lib/format';

const BLANK = { name: '', description: '', unit: 'sqft', price: '' };

export default function PriceListSection() {
  const [items, setItems] = useState([]);
  const [minimum, setMinimum] = useState('0');
  const [form, setForm] = useState(BLANK);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [p, s] = await Promise.all([
      sb.from('price_items').select('*').order('sort_order').order('name'),
      sb.from('settings').select('job_minimum').eq('id', 1).maybeSingle(),
    ]);
    setItems(p.data || []);
    if (s.data) setMinimum(String(s.data.job_minimum));
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function saveMinimum(e) {
    e.preventDefault();
    const { error } = await getSupabase().from('settings').update({ job_minimum: Number(minimum) || 0 }).eq('id', 1);
    setMsg(error ? { err: true, text: error.message } : { text: 'Minimum saved.' });
  }

  async function saveItem(e) {
    e.preventDefault();
    const row = { name: form.name.trim(), description: form.description, unit: form.unit, price: Number(form.price) };
    if (!row.name || Number.isNaN(row.price) || row.price < 0) { setMsg({ err: true, text: 'Enter a name and a price of zero or more.' }); return; }
    const sb = getSupabase();
    const { error } = editId ? await sb.from('price_items').update(row).eq('id', editId) : await sb.from('price_items').insert(row);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setForm(BLANK);
    setEditId(null);
    setMsg({ text: 'Saved.' });
    load();
  }

  async function toggleActive(it) {
    await getSupabase().from('price_items').update({ active: !it.active }).eq('id', it.id);
    load();
  }

  function edit(it) {
    setEditId(it.id);
    setForm({ name: it.name, description: it.description, unit: it.unit, price: String(it.price) });
  }

  return (
    <div className="card">
      <h2>Price list</h2>
      <p className="hint">Quotes are built from these items. Prices and fees can still be adjusted on each job.</p>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}

      <form onSubmit={saveMinimum} className="row" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Minimum charge per job</label>
          <input type="number" min="0" step="0.01" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
        </div>
        <button className="secondary">Save minimum</button>
      </form>

      <table className="table">
        <thead><tr><th>Item</th><th>Price</th><th></th></tr></thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} style={{ opacity: it.active ? 1 : 0.5 }}>
              <td>{it.name}{it.description && <div className="muted">{it.description}</div>}</td>
              <td>{money(it.price)} <span className="muted">{UNIT_LABELS[it.unit]}</span></td>
              <td>
                <button className="secondary small" onClick={() => edit(it)}>Edit</button>{' '}
                <button className="secondary small" onClick={() => toggleActive(it)}>{it.active ? 'Hide' : 'Show'}</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan="3" className="muted">No items yet. The owner enters these.</td></tr>}
        </tbody>
      </table>

      <form onSubmit={saveItem} style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 16 }}>{editId ? 'Edit item' : 'Add item'}</h2>
        <div className="grid2">
          <div className="field"><label>Name</label><input value={form.name} onChange={set('name')} required /></div>
          <div className="field"><label>Description</label><input value={form.description} onChange={set('description')} /></div>
          <div className="field"><label>Unit</label>
            <select value={form.unit} onChange={set('unit')}>
              {Object.entries(UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field"><label>Price</label><input type="number" min="0" step="0.01" value={form.price} onChange={set('price')} required /></div>
        </div>
        <div className="row">
          <button className="primary">{editId ? 'Save item' : 'Add item'}</button>
          {editId && <button type="button" className="secondary" onClick={() => { setEditId(null); setForm(BLANK); }}>Cancel</button>}
        </div>
      </form>
    </div>
  );
}
