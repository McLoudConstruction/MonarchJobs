'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { money, UNIT_LABELS } from '@/lib/format';
import SaveButton from '@/components/SaveButton';
import { useSaveStatus } from '@/lib/saveStatus';

const BLANK = { name: '', description: '', unit: 'sqft', price: '', is_addon: false, bookable_online: false, aftercare: '', dry_hours: '', minutes: '' };

export default function PriceListSection() {
  const [items, setItems] = useState([]);
  const [minimum, setMinimum] = useState('0');
  const [form, setForm] = useState(BLANK);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState(null);
  const minSave = useSaveStatus();
  const itemSave = useSaveStatus();

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
    return !error;
  }

  async function saveItem(e) {
    e.preventDefault();
    const dry = form.dry_hours === '' ? null : Math.round(Number(form.dry_hours));
    if (dry !== null && !(dry >= 1 && dry <= 72)) { setMsg({ err: true, text: 'Drying time is 1 to 72 hours, or leave it blank.' }); return false; }
    const mins = form.minutes === '' ? null : Number(form.minutes);
    if (mins !== null && !(mins >= 0 && mins <= 100000)) { setMsg({ err: true, text: 'Time per unit is a number of minutes (0 or more), or leave it blank.' }); return false; }
    const row = { minutes_per_unit: mins, name: form.name.trim(), description: form.description, unit: form.unit, price: Number(form.price), is_addon: !!form.is_addon, bookable_online: !!form.bookable_online, aftercare: form.aftercare.trim(), dry_hours: dry };
    if (!row.name || Number.isNaN(row.price) || row.price < 0) { setMsg({ err: true, text: 'Enter a name and a price of zero or more.' }); return false; }
    const sb = getSupabase();
    const { error } = editId ? await sb.from('price_items').update(row).eq('id', editId) : await sb.from('price_items').insert(row);
    if (error) { setMsg({ err: true, text: error.message }); return false; }
    setForm(BLANK);
    setEditId(null);
    setMsg({ text: 'Saved.' });
    load();
    return true;
  }

  async function toggleActive(it) {
    await getSupabase().from('price_items').update({ active: !it.active }).eq('id', it.id);
    load();
  }

  function edit(it) {
    setEditId(it.id);
    if (typeof window !== 'undefined' && window.innerWidth < 900) window.scrollTo({ top: 0, behavior: 'smooth' });
    setForm({ name: it.name, description: it.description, unit: it.unit, price: String(it.price), is_addon: !!it.is_addon, bookable_online: !!it.bookable_online, aftercare: it.aftercare || '', dry_hours: it.dry_hours ? String(it.dry_hours) : '', minutes: it.minutes_per_unit != null ? String(it.minutes_per_unit) : '' });
  }

  return (
    <div className="price-split">
      <div className="card price-form">
        <h2>{editId ? 'Edit item' : 'Add item'}</h2>
        <p className="hint">Quotes are built from these items. Prices and fees can still be adjusted on each job.</p>
        {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}

        <form onSubmit={itemSave.track(saveItem)}>
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
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input type="checkbox" checked={form.is_addon} onChange={(e) => setForm({ ...form, is_addon: e.target.checked })} />
            Offer as a one-tap add-on on estimates (for example, protectant or deodorizer)
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input type="checkbox" checked={form.bookable_online} onChange={(e) => setForm({ ...form, bookable_online: e.target.checked })} />
            Show on the online booking page (customers with the booking link can choose it)
          </label>
          <div className="field"><label>Aftercare for the customer (optional)</label>
            <textarea className="sig-notes" rows={3} maxLength={1500} value={form.aftercare} onChange={set('aftercare')} placeholder="Stay off the carpet for 2 hours. Wait 24 hours before moving furniture back..." />
          </div>
          <div className="field" style={{ maxWidth: 320 }}>
            <label>Time to do one unit (minutes, optional)</label>
            <input type="number" min="0" max="100000" step="0.01" value={form.minutes} onChange={set('minutes')} placeholder={form.unit === 'sqft' ? 'e.g. 0.05 minutes per sq ft' : form.unit === 'room' ? 'e.g. 20 minutes per room' : 'minutes for one'} />
            <div className="hint" style={{ marginTop: 4 }}>Sets the allotted time on carpet jobs: this many minutes for each {form.unit === 'sqft' ? 'sq ft' : form.unit === 'room' ? 'room' : form.unit === 'hour' ? 'hour (hours always count as 60 minutes)' : 'unit'} on the estimate. Compared with the clock to track dollars per hour.</div>
          </div>
          <div className="field" style={{ maxWidth: 220 }}><label>Dries in about (hours, optional)</label><input type="number" min="1" max="72" value={form.dry_hours} onChange={set('dry_hours')} /></div>
          <div className="row">
            <SaveButton save={itemSave} idle={editId ? 'Save item' : 'Add item'} className="primary" />
            {editId && <button type="button" className="secondary" onClick={() => { setEditId(null); setForm(BLANK); }}>Cancel</button>}
          </div>
        </form>

        <form onSubmit={minSave.track(saveMinimum)} className="row price-min" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Minimum charge per job</label>
            <input type="number" min="0" step="0.01" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
          </div>
          <SaveButton save={minSave} idle="Save minimum" className="secondary" />
        </form>
      </div>

      <aside className="card price-side" aria-label="Price list">
        <h2>Price list <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({items.length})</span></h2>
        <div className="price-side-list">
          {items.map((it) => (
            <div key={it.id} className={`price-row${editId === it.id ? ' editing' : ''}`} style={{ opacity: it.active ? 1 : 0.5 }}>
              <div className="price-row-main">
                <div className="price-row-name">{it.name}{it.is_addon && <span className="badge s-quoted" style={{ marginLeft: 6 }}>add-on</span>}{it.bookable_online && <span className="badge s-booked" style={{ marginLeft: 6 }}>online</span>}</div>
                {it.description && <div className="muted">{it.description}</div>}
                {it.minutes_per_unit != null && it.unit !== 'hour' && <div className="muted">Takes {Number(it.minutes_per_unit)} min {UNIT_LABELS[it.unit]}</div>}
                {(it.aftercare || it.dry_hours) && <div className="muted">Aftercare{it.dry_hours ? `, dries in about ${it.dry_hours} h` : ''}</div>}
              </div>
              <div className="price-row-price">{money(it.price)}<span className="muted"> {UNIT_LABELS[it.unit]}</span></div>
              <div className="price-row-actions">
                <button className="secondary small" onClick={() => edit(it)}>Edit</button>
                <button className="secondary small" onClick={() => toggleActive(it)}>{it.active ? 'Hide' : 'Show'}</button>
              </div>
            </div>
          ))}
          {items.length === 0 && <p className="muted">No items yet. Add the first one on the left.</p>}
        </div>
      </aside>
    </div>
  );
}
