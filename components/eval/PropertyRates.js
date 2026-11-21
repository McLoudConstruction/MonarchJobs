'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { cleanRate, rateMap } from '@/lib/propertyRates';
import { money, UNIT_LABELS } from '@/lib/format';

// Saved prices for one property (an apartment complex or management company). An estimate tied to this property uses
// these instead of the price list; anything left blank uses the standard price. Office and owner.
export default function PropertyRates({ propertyId }) {
  const [items, setItems] = useState(null);
  const [saved, setSaved] = useState(() => new Map());
  const [vals, setVals] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    Promise.all([
      sb.from('price_items').select('id,name,unit,price').eq('active', true).order('sort_order').order('name'),
      sb.from('property_rates').select('price_item_id,unit_price').eq('property_id', propertyId),
    ]).then(([p, r]) => {
      if (p.error || r.error) { setMsg({ err: true, text: 'Rates need database update 040. Run it in Supabase, then reload.' }); setItems([]); return; }
      const m = rateMap(r.data || []);
      setItems(p.data || []);
      setSaved(m);
      setVals(Object.fromEntries([...m].map(([k, v]) => [k, String(v)])));
    });
  }, [propertyId]);

  async function save() {
    setMsg(null);
    const upserts = [];
    const removals = [];
    for (const it of items) {
      const c = cleanRate(vals[it.id]);
      if (c.error) { setMsg({ err: true, text: `${it.name}: ${c.error}` }); return; }
      // blank, or the same as the standard price, means "no special rate"
      if (c.value === null || c.value === Number(it.price)) { if (saved.has(it.id)) removals.push(it.id); continue; }
      if (saved.get(it.id) !== c.value) upserts.push({ property_id: propertyId, price_item_id: it.id, unit_price: c.value, updated_at: new Date().toISOString() });
    }
    setBusy(true);
    const sb = getSupabase();
    if (upserts.length) {
      const { error } = await sb.from('property_rates').upsert(upserts, { onConflict: 'property_id,price_item_id' });
      if (error) { setBusy(false); setMsg({ err: true, text: error.message }); return; }
    }
    if (removals.length) {
      const { error } = await sb.from('property_rates').delete().eq('property_id', propertyId).in('price_item_id', removals);
      if (error) { setBusy(false); setMsg({ err: true, text: error.message }); return; }
    }
    const { data } = await sb.from('property_rates').select('price_item_id,unit_price').eq('property_id', propertyId);
    const m = rateMap(data || []);
    setSaved(m);
    setVals(Object.fromEntries([...m].map(([k, v]) => [k, String(v)])));
    setBusy(false);
    setMsg({ text: upserts.length || removals.length ? 'Rates saved. They apply to estimates tied to this property from now on.' : 'No changes.' });
  }

  if (!items) return <p className="muted">Loading rates...</p>;
  if (!items.length) return msg ? <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div> : <p className="muted">The price list is empty.</p>;
  return (
    <fieldset className="pf-contact">
      <legend>Rates for this property</legend>
      <p className="hint" style={{ marginTop: 0 }}>Type a price to use here instead of the standard one. Leave it blank for the standard price. On an estimate, choose this property under "Property rates".</p>
      <div className="prop-rates">
        {items.map((it) => (
          <div key={it.id} className="prop-rate">
            <span className="prop-rate-name">{it.name}<span className="muted"> · standard {money(it.price)} {UNIT_LABELS[it.unit]}</span></span>
            <input inputMode="decimal" placeholder={String(Number(it.price))} value={vals[it.id] ?? ''} aria-label={`Rate for ${it.name}`}
              onChange={(e) => setVals((v) => ({ ...v, [it.id]: e.target.value }))} />
          </div>
        ))}
      </div>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="secondary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save rates'}</button></div>
    </fieldset>
  );
}
