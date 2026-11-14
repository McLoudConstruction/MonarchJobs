'use client';
// Quote from the sketch: each room with its floor type and its square feet (fixed cabinets and appliances taken out),
// a service from the price list for the rooms that need it, and the lines go onto the job's estimate.
import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { roomQuoteRows, quoteQuantity } from '@/lib/sketchQuote';
import { money, UNIT_LABELS } from '@/lib/format';

export default function QuoteFromSketch({ jobId, plan, staff, roomId = null, onClose, onDone }) {
  const rows = useMemo(() => roomQuoteRows(plan), [plan]);
  const [items, setItems] = useState(null);
  const [est, setEst] = useState(undefined);
  const [pick, setPick] = useState({}); // roomId -> price item id
  const [useNet, setUseNet] = useState(true);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    Promise.all([
      sb.from('price_items').select('id,name,unit,price').eq('active', true).order('sort_order').order('name'),
      sb.from('estimates').select('id,status').eq('job_id', jobId).maybeSingle(),
    ]).then(([p, e]) => { setItems(p.data || []); setEst(e.data || null); });
  }, [jobId]);

  const shown = roomId ? rows.filter((r) => r.id === roomId) : rows;
  const chosen = shown.map((r) => ({ r, item: (items || []).find((i) => i.id === pick[r.id]) })).filter((x) => x.item);
  const total = chosen.reduce((s, { r, item }) => s + Math.round(quoteQuantity(item.unit, r, useNet) * 1000) * Math.round(item.price * 100) / 1000, 0) / 100;
  const locked = est && est.status !== 'draft';

  async function add() {
    if (!chosen.length) return;
    setBusy(true); setMsg(null);
    const sb = getSupabase();
    let estimateId = est?.id;
    if (!estimateId) {
      const { data: s } = await sb.from('settings').select('job_minimum').eq('id', 1).maybeSingle();
      const { data, error } = await sb.from('estimates').insert({ job_id: jobId, minimum_charge: s?.job_minimum ?? 0, created_by: staff.id }).select('id,status').single();
      if (error) { setBusy(false); setMsg({ err: true, text: error.message }); return; }
      estimateId = data.id; setEst(data);
    }
    const { count } = await sb.from('estimate_lines').select('id', { count: 'exact', head: true }).eq('estimate_id', estimateId);
    const lines = chosen.map(({ r, item }, i) => ({
      estimate_id: estimateId, price_item_id: item.id,
      description: `${item.name} - ${r.name}${r.floor ? ` (${r.floor})` : ''}`.slice(0, 200),
      unit: item.unit, quantity: quoteQuantity(item.unit, r, useNet), unit_price: item.price, is_custom: false, sort_order: (count || 0) + i, created_by: staff.id,
    }));
    const { error } = await sb.from('estimate_lines').insert(lines);
    setBusy(false);
    if (error) { setMsg({ err: true, text: error.message.includes('row-level security') ? 'Not allowed. The estimate may already be sent, or the job closed.' : error.message }); return; }
    onDone?.(lines.length);
    onClose();
  }

  return (
    <div className="sketch-modal" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sketch-modal-card sk-quote" role="dialog" aria-label="Quote from sketch">
        <div className="sketch-pop-head"><strong>{roomId ? 'Add a service to the quote' : 'Quote from sketch'}</strong><button type="button" className="sk-x" aria-label="Close" onClick={onClose}>{'×'}</button></div>
        {items === null && <p className="muted">Loading the price list...</p>}
        {items && items.length === 0 && <p className="muted">The price list is empty. The owner adds services in Settings.</p>}
        {locked && <div className="msg err">This job's estimate is already {est.status}. New lines may be refused.</div>}
        {items && items.length > 0 && (
          <>
            <label className="sk-check"><input type="checkbox" checked={useNet} onChange={(e) => setUseNet(e.target.checked)} /> Take fixed cabinets and appliances out of the square feet</label>
            <ul className="sk-quote-rooms">
              {shown.map((r) => {
                const item = items.find((i) => i.id === pick[r.id]);
                const qty = item ? quoteQuantity(item.unit, r, useNet) : null;
                return (
                  <li key={r.id}>
                    <div className="sk-quote-head"><strong>{r.name}</strong><span className="muted">{r.floor || 'Floor not set'} {'·'} {useNet ? r.net : r.area} sq ft{useNet && r.fixed > 0 ? ` (${r.area} less ${r.fixed} fixed)` : ''}</span></div>
                    <select aria-label={`Service for ${r.name}`} value={pick[r.id] || ''} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}>
                      <option value="">No service</option>
                      {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({money(i.price)} {UNIT_LABELS[i.unit]})</option>)}
                    </select>
                    {item && <div className="muted">{qty} {item.unit === 'sqft' ? 'sq ft' : item.unit === 'room' ? 'room' : UNIT_LABELS[item.unit]} {'×'} {money(item.price)} = {money(Math.round(qty * 1000) * Math.round(item.price * 100) / 100000)}</div>}
                  </li>
                );
              })}
            </ul>
            {msg && <div className={`msg${msg.err ? ' err' : ''}`}>{msg.text}</div>}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>{chosen.length ? `${chosen.length} line${chosen.length === 1 ? '' : 's'} · ${money(total)}` : 'Choose a service for a room'}</span>
              <button type="button" className="primary" disabled={!chosen.length || busy} onClick={add}>{busy ? 'Adding...' : 'Add to estimate'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
