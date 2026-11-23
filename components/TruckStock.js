'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { staffName } from '@/lib/userDisplay';
import { stockStatus, STATUS_LABEL, cleanTruck, cleanItem, cleanQty, qtyText } from '@/lib/truckStock';
import PopupModal from '@/components/PopupModal';

const BLANK_ITEM = { name: '', unit: '', per_visit: '', low_at: '' };

// Supplies on each truck. Office and owner set up the trucks and supplies; a tech can restock or recount the truck they drive.
// Finishing a visit takes each supply's "used per visit" off the finishing tech's truck (once per crew); "low at" raises the alert.
export default function TruckStock({ staff }) {
  const isOffice = staff.role !== 'tech';
  const [trucks, setTrucks] = useState(null);
  const [items, setItems] = useState([]);
  const [stock, setStock] = useState([]);
  const [people, setPeople] = useState([]);
  const [missing, setMissing] = useState(false);
  const [msg, setMsg] = useState(null);
  const [truckForm, setTruckForm] = useState(null); // { id?, name, tech_ids }
  const [itemForm, setItemForm] = useState(null);   // { id?, name, unit, per_visit, low_at }
  const [qtyForm, setQtyForm] = useState(null);     // { truck, item, mode: 'add' | 'count', value }

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [t, i, s, p] = await Promise.all([
      sb.from('trucks').select('id,name,tech_ids,active').order('created_at'),
      sb.from('truck_items').select('id,name,unit,per_visit,low_at,active').order('name'),
      sb.from('truck_stock').select('truck_id,item_id,qty'),
      sb.from('staff_users').select('id,full_name,email,role').eq('active', true).order('full_name'),
    ]);
    if (t.error) { setMissing(true); return; }
    setMissing(false);
    setTrucks(t.data || []); setItems(i.data || []); setStock(s.data || []); setPeople(p.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const mine = useMemo(() => (trucks || []).filter((t) => t.active && (isOffice || (t.tech_ids || []).includes(staff.id))), [trucks, isOffice, staff.id]);
  const qtyOf = (t, i) => stock.find((s) => s.truck_id === t.id && s.item_id === i.id)?.qty;
  const nameOf = (id) => { const x = people.find((q) => q.id === id); return x ? staffName(x) : 'Former staff member'; };

  async function saveTruck(e) {
    e.preventDefault();
    const c = cleanTruck(truckForm);
    if (c.error) { setMsg({ err: true, text: c.error }); return; }
    const sb = getSupabase();
    const { error } = truckForm.id ? await sb.from('trucks').update(c.value).eq('id', truckForm.id) : await sb.from('trucks').insert(c.value);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setTruckForm(null); setMsg(null); load();
  }
  async function saveItem(e) {
    e.preventDefault();
    const c = cleanItem(itemForm);
    if (c.error) { setMsg({ err: true, text: c.error }); return; }
    const sb = getSupabase();
    const { error } = itemForm.id ? await sb.from('truck_items').update(c.value).eq('id', itemForm.id) : await sb.from('truck_items').insert(c.value);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setItemForm(null); setMsg(null); load();
  }
  async function setActive(table, id, active) {
    await getSupabase().from(table).update({ active }).eq('id', id);
    load();
  }
  async function saveQty(e) {
    e.preventDefault();
    const c = cleanQty(qtyForm.value);
    if (c.error) { setMsg({ err: true, text: c.error }); return; }
    const { error } = await getSupabase().rpc('truck_adjust', { p_truck: qtyForm.truck.id, p_item: qtyForm.item.id, p_mode: qtyForm.mode, p_value: c.value, p_note: '' });
    if (error) { setMsg({ err: true, text: error.message.includes('NOT_ALLOWED') ? 'Only people on this truck can change its stock.' : error.message }); return; }
    setQtyForm(null); setMsg(null); load();
  }

  if (missing) return <div className="card"><p className="muted">Truck stock needs database update 048. Run it in Supabase, then reload.</p></div>;
  if (trucks === null) return <p className="muted">Loading...</p>;
  const activeItems = items.filter((i) => i.active);

  return (
    <>
      {msg && <div className={`msg${msg.err ? ' err' : ''}`}>{msg.text}</div>}
      {isOffice && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <button type="button" className="primary" onClick={() => { setMsg(null); setTruckForm({ name: '', tech_ids: [] }); }}>Add truck</button>
          <button type="button" className="secondary" onClick={() => { setMsg(null); setItemForm(BLANK_ITEM); }}>Add supply</button>
        </div>
      )}
      {mine.length === 0 && <p className="muted">{isOffice ? 'No trucks yet. Add a truck, then add the supplies it carries.' : 'You are not on a truck yet. Ask the office to add you to one.'}</p>}

      {mine.map((t) => (
        <div className="card" key={t.id}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{t.name}</h2>
            {isOffice && <div className="row">
              <button type="button" className="secondary" onClick={() => { setMsg(null); setTruckForm({ id: t.id, name: t.name, tech_ids: t.tech_ids || [] }); }}>Edit</button>
              <button type="button" className="secondary" onClick={() => setActive('trucks', t.id, false)}>Retire</button>
            </div>}
          </div>
          <p className="hint">{(t.tech_ids || []).length ? `Driven by ${(t.tech_ids || []).map(nameOf).join(', ')}.` : 'Nobody is on this truck yet, so finished visits do not take anything off it.'}</p>
          {activeItems.length === 0 && <p className="muted">No supplies yet.</p>}
          {activeItems.length > 0 && (
            <table className="own-table">
              <thead><tr><th>Supply</th><th>On the truck</th><th></th></tr></thead>
              <tbody>
                {activeItems.map((i) => {
                  const q = qtyOf(t, i);
                  const st = q === undefined ? 'ok' : stockStatus(q, i.low_at);
                  return (
                    <tr key={i.id}>
                      <td>{i.name}{isOffice && <div className="hint">Uses {Number(i.per_visit)} per visit · low at {Number(i.low_at)}</div>}</td>
                      <td>{q === undefined ? 'Not counted' : qtyText(q, i.unit)} {st !== 'ok' && <span className="badge s-lost">{STATUS_LABEL[st]}</span>}</td>
                      <td className="row" style={{ gap: 6 }}>
                        <button type="button" className="secondary" onClick={() => { setMsg(null); setQtyForm({ truck: t, item: i, mode: 'add', value: '' }); }}>Add stock</button>
                        <button type="button" className="secondary" onClick={() => { setMsg(null); setQtyForm({ truck: t, item: i, mode: 'count', value: q === undefined ? '' : String(q) }); }}>Recount</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {isOffice && items.length > 0 && (
        <div className="card">
          <h2>Supplies</h2>
          <p className="hint">The list every truck can carry. Turning a supply off hides it everywhere; its history stays.</p>
          <ul>
            {items.map((i) => (
              <li key={i.id} className="row" style={{ gap: 8, margin: '4px 0' }}>
                <span style={{ minWidth: 200, opacity: i.active ? 1 : 0.5 }}>{i.name}{i.unit ? ` (${i.unit})` : ''} · uses {Number(i.per_visit)} per visit · low at {Number(i.low_at)}</span>
                <button type="button" className="secondary" onClick={() => { setMsg(null); setItemForm({ id: i.id, name: i.name, unit: i.unit, per_visit: String(i.per_visit), low_at: String(i.low_at) }); }}>Edit</button>
                <button type="button" className="secondary" onClick={() => setActive('truck_items', i.id, !i.active)}>{i.active ? 'Turn off' : 'Turn on'}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <PopupModal open={!!truckForm} onClose={() => setTruckForm(null)} title={truckForm?.id ? 'Edit truck' : 'Add truck'}>
        {truckForm && (
          <form onSubmit={saveTruck}>
            <label className="field">Name<input value={truckForm.name} maxLength={40} onChange={(e) => setTruckForm({ ...truckForm, name: e.target.value })} placeholder="Truck 1" /></label>
            <p className="hint">Who drives it. When one of them finishes a visit, the supplies come off this truck.</p>
            {people.map((p) => (
              <label key={p.id} className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={(truckForm.tech_ids || []).includes(p.id)}
                  onChange={(e) => setTruckForm({ ...truckForm, tech_ids: e.target.checked ? [...(truckForm.tech_ids || []), p.id] : truckForm.tech_ids.filter((x) => x !== p.id) })} />
                {staffName(p)}
              </label>
            ))}
            {msg?.err && <div className="msg err">{msg.text}</div>}
            <div className="row" style={{ marginTop: 8 }}><button type="button" className="secondary" onClick={() => setTruckForm(null)}>Cancel</button><button className="primary">Save</button></div>
          </form>
        )}
      </PopupModal>

      <PopupModal open={!!itemForm} onClose={() => setItemForm(null)} title={itemForm?.id ? 'Edit supply' : 'Add supply'}>
        {itemForm && (
          <form onSubmit={saveItem}>
            <label className="field">Name<input value={itemForm.name} maxLength={60} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} placeholder="Spotter" /></label>
            <label className="field">Unit (optional)<input value={itemForm.unit} maxLength={20} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} placeholder="bottles" /></label>
            <label className="field">Used per visit<input inputMode="decimal" value={itemForm.per_visit} onChange={(e) => setItemForm({ ...itemForm, per_visit: e.target.value })} placeholder="0" /></label>
            <p className="hint">Taken off the truck each time a visit is finished. Leave 0 for supplies you only count by hand.</p>
            <label className="field">Alert me when this is down to<input inputMode="decimal" value={itemForm.low_at} onChange={(e) => setItemForm({ ...itemForm, low_at: e.target.value })} placeholder="0" /></label>
            <p className="hint">Leave 0 for no alert.</p>
            {msg?.err && <div className="msg err">{msg.text}</div>}
            <div className="row" style={{ marginTop: 8 }}><button type="button" className="secondary" onClick={() => setItemForm(null)}>Cancel</button><button className="primary">Save</button></div>
          </form>
        )}
      </PopupModal>

      <PopupModal open={!!qtyForm} onClose={() => setQtyForm(null)} title={qtyForm ? `${qtyForm.item.name} on ${qtyForm.truck.name}` : ''}>
        {qtyForm && (
          <form onSubmit={saveQty}>
            <label className="field">{qtyForm.mode === 'add' ? `How many did you add${qtyForm.item.unit ? ` (${qtyForm.item.unit})` : ''}?` : `How many are on the truck now${qtyForm.item.unit ? ` (${qtyForm.item.unit})` : ''}?`}
              <input autoFocus inputMode="decimal" value={qtyForm.value} onChange={(e) => setQtyForm({ ...qtyForm, value: e.target.value })} />
            </label>
            {msg?.err && <div className="msg err">{msg.text}</div>}
            <div className="row" style={{ marginTop: 8 }}><button type="button" className="secondary" onClick={() => setQtyForm(null)}>Cancel</button><button className="primary">Save</button></div>
          </form>
        )}
      </PopupModal>
    </>
  );
}
