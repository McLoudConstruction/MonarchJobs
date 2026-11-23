'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { lineCents, estimateSnapshot, sameSnapshot, ESTIMATE_STATUS } from '@/lib/estimate';
import { money, fmtDateTime, UNIT_LABELS } from '@/lib/format';
import { displayPhone, toE164 } from '@/lib/phone';
import { hasFeature } from '@/lib/services';
import { rateMap, priceFor, rateChanges } from '@/lib/propertyRates';
import { expiryNote } from '@/lib/estimateExpiry';
import { LINE_KINDS, lineKind, kindFields, lineKindLabel, hasTiers, tiersPresent, tierTotals, currentTotals, effectiveLines, choiceFromEstimate, TIER_LABELS } from '@/lib/estimateOptions';
import SaveButton from '@/components/SaveButton';
import { useSaveStatus } from '@/lib/saveStatus';

const BLANK_CUSTOM = { description: '', quantity: '1', unit: 'flat', unit_price: '', kind: 'included' };

// Estimate on a lead or on a job (scope = { leadId } or { jobId }). Office/owner, and the assigned tech
// on a job, can add, change and remove lines while it is open; every change is logged by the database
// with who and when. The office sends it to the customer by text and email; the customer approves and
// signs on the secure link.
export default function EstimateCard({ service = '', scope, open, staff, token, contact, onChanged }) {
  const isOffice = staff.role !== 'tech';
  const scopeCol = scope.leadId ? 'lead_id' : 'job_id';
  const scopeId = scope.leadId || scope.jobId;

  const [est, setEst] = useState(undefined); // undefined = loading, null = none yet
  const [lines, setLines] = useState([]);
  const [items, setItems] = useState([]);
  const [pickId, setPickId] = useState('');
  const [pickQty, setPickQty] = useState('1');
  const [pickKind, setPickKind] = useState('included');
  const [manualTier, setManualTier] = useState('');
  const [custom, setCustom] = useState(null);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState(null);
  const [minimum, setMinimum] = useState('');
  const [msg, setMsg] = useState(null);
  const minSave = useSaveStatus();
  const [signature, setSignature] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [properties, setProperties] = useState([]);
  const [rates, setRates] = useState(() => new Map());
  const [followupsSent, setFollowupsSent] = useState(0);
  const [tz, setTz] = useState('America/Chicago');

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data: e } = await sb.from('estimates').select('*').eq(scopeCol, scopeId).maybeSingle();
    setEst(e || null);
    if (e) {
      setMinimum(String(e.minimum_charge));
      const [{ data: l }, { data: sig }] = await Promise.all([
        sb.from('estimate_lines').select('*').eq('estimate_id', e.id).order('sort_order').order('created_at'),
        sb.from('estimate_signatures').select('*').eq('estimate_id', e.id).order('signed_at', { ascending: false }).limit(1),
      ]);
      setLines(l || []);
      setSignature(sig?.[0] || null);
    }
    const { data: p } = await sb.from('price_items').select('*').eq('active', true).order('sort_order').order('name');
    setItems(p || []);
    // Per-property rates, follow-ups sent and the time zone for the valid-through date. Each is optional: if migration 040
    // has not been run, these just come back empty.
    const [{ data: props }, { data: st }] = await Promise.all([
      sb.from('properties').select('id,name').order('name'),
      sb.from('settings').select('timezone').eq('id', 1).maybeSingle(),
    ]);
    setProperties(props || []);
    setTz(st?.timezone || 'America/Chicago');
    if (e?.property_id) {
      const { data: r } = await sb.from('property_rates').select('price_item_id,unit_price').eq('property_id', e.property_id);
      setRates(rateMap(r || []));
    } else setRates(new Map());
    if (e && e.status !== 'draft') {
      const { count } = await sb.from('estimate_followups').select('id', { count: 'exact', head: true }).eq('estimate_id', e.id);
      setFollowupsSent(count || 0);
    } else setFollowupsSent(0);
  }, [scopeCol, scopeId]);

  useEffect(() => { load(); }, [load]);

  async function changed() {
    await load();
    onChanged?.();
  }

  function fail(error) {
    setMsg({ err: true, text: error.message.includes('row-level security') ? 'Not allowed. The job may be closed or cancelled, or the lead already has a work order.' : error.message });
  }

  async function start() {
    setMsg(null);
    const { data: s } = await getSupabase().from('settings').select('job_minimum').eq('id', 1).maybeSingle();
    const { error } = await getSupabase().from('estimates').insert({ [scopeCol]: scopeId, minimum_charge: s?.job_minimum ?? 0, created_by: staff.id });
    if (error) return fail(error);
    changed();
  }

  async function insertItem(item, qty, kind) {
    setMsg(null);
    const { error } = await getSupabase().from('estimate_lines').insert({
      estimate_id: est.id, price_item_id: item.id, description: item.name, unit: item.unit,
      quantity: qty, unit_price: priceFor(item, rates), is_custom: false, sort_order: lines.length, created_by: staff.id,
      ...kindFields(kind),
    });
    if (error) return fail(error);
    changed();
  }

  async function addFromList(e) {
    e.preventDefault();
    const item = items.find((i) => i.id === pickId);
    if (!item) { setMsg({ err: true, text: 'Choose a service from the price list.' }); return; }
    const qty = Number(pickQty);
    if (!(qty >= 0)) { setMsg({ err: true, text: 'Enter a quantity.' }); return; }
    await insertItem(item, qty, pickKind);
    setPickId(''); setPickQty('1');
  }

  // One tap: the add-on goes on the estimate as an optional line the customer can tick.
  const addAddon = (item) => insertItem(item, 1, 'optional');

  async function addCustom(e) {
    e.preventDefault();
    const qty = Number(custom.quantity);
    const price = Number(custom.unit_price);
    if (!custom.description.trim() || Number.isNaN(price) || !(qty >= 0)) { setMsg({ err: true, text: 'Enter a description, quantity and price.' }); return; }
    setMsg(null);
    const { error } = await getSupabase().from('estimate_lines').insert({
      estimate_id: est.id, description: custom.description.trim(), unit: custom.unit, quantity: qty,
      unit_price: price, is_custom: true, sort_order: lines.length, created_by: staff.id, ...kindFields(custom.kind),
    });
    if (error) return fail(error);
    setCustom(null);
    changed();
  }

  async function saveEdit(e) {
    e.preventDefault();
    const qty = Number(edit.quantity);
    const price = Number(edit.unit_price);
    if (!edit.description.trim() || Number.isNaN(price) || !(qty >= 0)) { setMsg({ err: true, text: 'Enter a description, quantity and price.' }); return; }
    const { error } = await getSupabase().from('estimate_lines').update({ description: edit.description.trim(), quantity: qty, unit_price: price, ...kindFields(edit.kind) }).eq('id', editId);
    if (error) return fail(error);
    setEditId(null);
    changed();
  }

  async function removeLine(l) {
    if (!window.confirm(`Remove "${l.description}"?`)) return;
    const { error } = await getSupabase().from('estimate_lines').delete().eq('id', l.id);
    if (error) return fail(error);
    changed();
  }

  async function updateEstimate(patch) {
    setMsg(null);
    const { error } = await getSupabase().from('estimates').update(patch).eq('id', est.id);
    if (error) { fail(error); return false; }
    changed();
    return true;
  }

  // Tie the estimate to a property so its saved rates are used. Lines already on the estimate keep their prices until
  // "Apply property rates" is tapped.
  async function pickProperty(id) {
    await updateEstimate({ property_id: id || null });
  }

  async function applyRates() {
    const changes = rateChanges(lines, rates);
    setMsg(null);
    for (const c of changes) {
      const { error } = await getSupabase().from('estimate_lines').update({ unit_price: c.to }).eq('id', c.id);
      if (error) return fail(error);
    }
    changed();
  }

  async function extend(days) {
    setMsg(null);
    const { error } = await getSupabase().rpc('extend_estimate_expiry', { p_estimate: est.id, p_days: days });
    if (error) { setMsg({ err: true, text: /NOT_ALLOWED/.test(error.message) ? 'Only the owner can extend an estimate.' : error.message }); return; }
    changed();
  }

  async function send() {
    setSending(true);
    setMsg(null);
    setSendResult(null);
    try {
      const r = await apiFetch(`/api/estimates/${est.id}/send`, token, { method: 'POST' });
      setSendResult(r);
      changed();
    } catch (err) {
      setMsg({ err: true, text: err.message });
    }
    setSending(false);
  }

  if (est === undefined) return <div className="card"><h2>Estimate</h2><p className="muted">Loading...</p></div>;

  if (est === null) {
    return (
      <div className="card">
        <h2>Estimate</h2>
        {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
        {open ? <button className="primary" onClick={start}>Start estimate</button> : <p className="muted">No estimate.</p>}
      </div>
    );
  }

  const tiered = hasTiers(lines);
  // Good / Better / Best and add-ons are for carpet; a quote that already has them keeps showing the controls.
  const showOptions = hasFeature(service, 'estimateOptions') || tiered || lines.some((l) => l.optional);
  const totals = currentTotals(est, lines);
  const perTier = tierTotals(lines, est.minimum_charge);
  const addonItems = items.filter((i) => i.is_addon);
  const link = typeof window !== 'undefined' ? `${window.location.origin}/e/${est.share_token}` : '';
  const expiry = expiryNote(est, new Date(), tz);
  const pending = rateChanges(lines, rates);
  const property = properties.find((p) => p.id === est.property_id);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Estimate</h2>
        <span className={`badge ${est.status === 'approved' ? 's-completed' : est.status === 'declined' ? 's-cancelled' : est.status === 'sent' ? 's-quoted' : 'off'}`}>{ESTIMATE_STATUS[est.status]}</span>
      </div>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      {expiry && (
        <div className={`banner ${expiry[1] === 'flag' ? 'flag' : 'info'}`} style={{ marginBottom: 10 }}>
          {expiry[0]}
          {staff.role === 'owner' && (
            <span style={{ marginLeft: 10, whiteSpace: 'nowrap' }}>
              Extend: {[7, 14, 30].map((d) => <button key={d} type="button" className="secondary small" style={{ marginLeft: 4 }} onClick={() => extend(d)}>{d} days</button>)}
            </span>
          )}
        </div>
      )}
      {property && <p className="hint" style={{ margin: '0 0 8px' }}>Priced with the rates for {property.name}{rates.size === 0 ? ' (it has no saved rates yet, so standard prices apply)' : ''}.</p>}

      <table className="table">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr></thead>
        <tbody>
          {lines.map((l) => (
            editId === l.id ? (
              <tr key={l.id}>
                <td colSpan="5">
                  <form onSubmit={saveEdit} className="grid2">
                    <div className="field"><label>Description</label><input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
                    <div className="row">
                      <div className="field" style={{ flex: 1 }}><label>Qty</label><input type="number" step="0.001" min="0" value={edit.quantity} onChange={(e) => setEdit({ ...edit, quantity: e.target.value })} /></div>
                      <div className="field" style={{ flex: 1 }}><label>Price</label><input type="number" step="0.01" value={edit.unit_price} onChange={(e) => setEdit({ ...edit, unit_price: e.target.value })} /></div>
                    </div>
                    {showOptions && <div className="field"><label>Line type</label>
                      <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                        {LINE_KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>}
                    <div className="row"><button className="primary small">Save</button><button type="button" className="secondary small" onClick={() => setEditId(null)}>Cancel</button></div>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={l.id}>
                <td>{l.description}{l.is_custom && <span className="badge off" style={{ marginLeft: 6 }}>custom</span>}{lineKindLabel(l) && <span className="badge s-quoted" style={{ marginLeft: 6 }}>{lineKindLabel(l)}</span>}{l.optional && l.accepted && <span className="badge s-completed" style={{ marginLeft: 6 }}>customer added</span>}</td>
                <td>{Number(l.quantity)}</td>
                <td>{money(l.unit_price)} <span className="muted">{UNIT_LABELS[l.unit]}</span></td>
                <td style={{ textAlign: 'right' }}>{money(lineCents(l) / 100)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {open && <>
                    <button className="secondary small" onClick={() => { setEditId(l.id); setEdit({ description: l.description, quantity: String(Number(l.quantity)), unit_price: String(l.unit_price), kind: lineKind(l) }); }}>Edit</button>{' '}
                    <button className="danger small" onClick={() => removeLine(l)}>Remove</button>
                  </>}
                </td>
              </tr>
            )
          ))}
          {lines.length === 0 && <tr><td colSpan="5" className="muted">No lines yet.</td></tr>}
          <tr><td colSpan="3">Subtotal</td><td style={{ textAlign: 'right' }}>{money(totals.subtotalCents / 100)}</td><td></td></tr>
          {totals.minimumAdjustmentCents > 0 && (
            <tr><td colSpan="3">Minimum charge adjustment ({money(est.minimum_charge)} minimum)</td><td style={{ textAlign: 'right' }}>{money(totals.minimumAdjustmentCents / 100)}</td><td></td></tr>
          )}
          <tr><th colSpan="3">{est.status === 'approved' ? 'Total (customer choice)' : tiered ? 'Total (included lines only)' : 'Total'}</th><th style={{ textAlign: 'right' }}>{money(totals.totalCents / 100)}</th><td></td></tr>
          {tiered && est.status !== 'approved' && tiersPresent(lines).map((k) => (
            <tr key={k}><td colSpan="3" className="muted">If the customer chooses {TIER_LABELS[k]}</td><td style={{ textAlign: 'right' }}>{money(perTier[k].totalCents / 100)}</td><td></td></tr>
          ))}
        </tbody>
      </table>

      {open && (
        <>
          <form onSubmit={addFromList} className="row" style={{ marginTop: 14, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 2, minWidth: 180, marginBottom: 0 }}>
              <label>Add from price list</label>
              <select value={pickId} onChange={(e) => setPickId(e.target.value)}>
                <option value="">Choose a service...</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({money(priceFor(i, rates))} {UNIT_LABELS[i.unit]})</option>)}
              </select>
            </div>
            <div className="field" style={{ width: 110, marginBottom: 0 }}><label>Qty</label><input type="number" step="0.001" min="0" value={pickQty} onChange={(e) => setPickQty(e.target.value)} /></div>
            {showOptions && <div className="field" style={{ width: 150, marginBottom: 0 }}><label>Line type</label>
              <select value={pickKind} onChange={(e) => setPickKind(e.target.value)}>
                {LINE_KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>}
            <button className="primary">Add</button>
            <button type="button" className="secondary" onClick={() => setCustom(custom ? null : { ...BLANK_CUSTOM })}>Custom line</button>
          </form>
          {showOptions && addonItems.length > 0 && (
            <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
              <span className="muted">Add-ons:</span>
              {addonItems.map((i) => <button key={i.id} type="button" className="secondary small" onClick={() => addAddon(i)}>+ {i.name} ({money(priceFor(i, rates))})</button>)}
            </div>
          )}
          {showOptions && <p className="hint" style={{ marginTop: 8 }}>Good, Better and Best options let the customer pick one when they approve. Optional add-ons are ticked by the customer.</p>}
          {items.length === 0 && <p className="hint" style={{ marginTop: 8 }}>The price list is empty. The owner adds services in Settings.</p>}
          {custom && (
            <form onSubmit={addCustom} style={{ marginTop: 12 }}>
              <div className="grid2">
                <div className="field"><label>Description</label><input value={custom.description} onChange={(e) => setCustom({ ...custom, description: e.target.value })} placeholder="Heavy soil charge" /></div>
                <div className="row">
                  <div className="field" style={{ flex: 1 }}><label>Qty</label><input type="number" step="0.001" min="0" value={custom.quantity} onChange={(e) => setCustom({ ...custom, quantity: e.target.value })} /></div>
                  <div className="field" style={{ flex: 1 }}><label>Price</label><input type="number" step="0.01" value={custom.unit_price} onChange={(e) => setCustom({ ...custom, unit_price: e.target.value })} placeholder="Use a minus for a discount" /></div>
                  <div className="field" style={{ flex: 1 }}><label>Unit</label>
                    <select value={custom.unit} onChange={(e) => setCustom({ ...custom, unit: e.target.value })}>
                      {Object.entries(UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              {showOptions && <div className="field"><label>Line type</label>
                <select value={custom.kind} onChange={(e) => setCustom({ ...custom, kind: e.target.value })}>
                  {LINE_KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>}
              <button className="primary small">Add custom line</button>
            </form>
          )}
        </>
      )}

      {isOffice && (
        <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          {properties.length > 0 && est.status !== 'approved' && (
            <div className="row" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
              <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
                <label>Property rates (optional)</label>
                <select value={est.property_id || ''} onChange={(e) => pickProperty(e.target.value)}>
                  <option value="">Standard prices</option>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {open && pending.length > 0 && <button type="button" className="secondary" onClick={applyRates}>Apply property rates to {pending.length} {pending.length === 1 ? 'line' : 'lines'}</button>}
            </div>
          )}
          <form className="row" style={{ alignItems: 'flex-end', marginBottom: 12 }} onSubmit={minSave.track(async (e) => { e.preventDefault(); return updateEstimate({ minimum_charge: Number(minimum) || 0 }); })}>
            <div className="field" style={{ marginBottom: 0 }}><label>Minimum charge for this job</label><input type="number" min="0" step="0.01" value={minimum} onChange={(e) => setMinimum(e.target.value)} /></div>
            <SaveButton save={minSave} idle="Save minimum" className="secondary" />
          </form>

          <div className="row">
            {est.status !== 'approved' && (
              <button className="primary" disabled={sending || lines.length === 0} onClick={send}>
                {sending ? 'Sending...' : est.status === 'draft' ? 'Send to customer' : 'Send again'}
              </button>
            )}
            {est.status === 'sent' && <>
              {tiered && (
                <select value={manualTier} onChange={(e) => setManualTier(e.target.value)} aria-label="Option the customer chose">
                  <option value="">Option chosen...</option>
                  {tiersPresent(lines).map((k) => <option key={k} value={k}>{TIER_LABELS[k]}</option>)}
                </select>
              )}
              <button className="secondary" disabled={tiered && !manualTier} onClick={() => updateEstimate({ status: 'approved', approved_at: new Date().toISOString(), chosen_tier: tiered ? manualTier : null })}>Mark approved</button>
              <button className="danger" onClick={() => updateEstimate({ status: 'declined', declined_at: new Date().toISOString() })}>Mark declined</button>
            </>}
            {est.status === 'draft' && <button className="secondary" onClick={() => updateEstimate({ status: 'sent', sent_at: new Date().toISOString() })}>Mark as sent (without messaging)</button>}
            {est.status !== 'draft' && <button className="secondary" onClick={async () => { await getSupabase().from('estimate_lines').update({ accepted: false }).eq('estimate_id', est.id); updateEstimate({ status: 'draft', chosen_tier: null }); }}>Back to draft</button>}
            <a href={`/e/${est.share_token}?preview=1`} target="_blank" rel="noreferrer"><button type="button" className="secondary">Preview customer view</button></a>
          </div>
          {est.status !== 'approved' && (
            <p className="hint" style={{ marginTop: 8 }}>
              Sends a text and an email with a link to view and approve the estimate to{' '}
              {[contact?.phone && displayPhone(contact.phone), contact?.email].filter(Boolean).join(' and ') || 'the customer (no phone or email on file yet)'}.
            </p>
          )}

          {sendResult && (
            <div className={`msg ${sendResult.ok ? 'ok' : 'err'}`}>
              {sendResult.ok ? 'Sent.' : 'Nothing could be sent automatically.'}
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                <li>Text: {sendResult.results.sms.detail}</li>
                <li>Email: {sendResult.results.email.detail}</li>
              </ul>
              {!sendResult.ok && (
                <div className="row" style={{ marginTop: 8 }}>
                  {toE164(contact?.phone) && <a href={`sms:${toE164(contact.phone)}?&body=${encodeURIComponent(sendResult.sms_body)}`}><button type="button" className="secondary small">Open in Messages</button></a>}
                  {contact?.email && <a href={`mailto:${contact.email}?subject=${encodeURIComponent(sendResult.subject)}&body=${encodeURIComponent(sendResult.text_body)}`}><button type="button" className="secondary small">Open in email</button></a>}
                  <button type="button" className="secondary small" onClick={() => updateEstimate({ status: 'sent', sent_at: new Date().toISOString() })}>I sent it myself</button>
                </div>
              )}
            </div>
          )}

          {signature && (
            <div className="field-actions" style={{ marginTop: 12 }}>
              <strong>Approved by {signature.signer_name}</strong> on {fmtDateTime(signature.signed_at)} for {money(signature.total_cents / 100)}.
              <div><img src={signature.signature_png} alt={`Signature of ${signature.signer_name}`} style={{ maxWidth: 260, maxHeight: 90, border: '1px solid var(--border)', borderRadius: 6, background: '#fff', marginTop: 6 }} /></div>
              {signature.preferred_times && <div className="meta">Preferred times: {signature.preferred_times}</div>}
              {!sameSnapshot(signature.lines_snapshot ? { minimum_charge: signature.minimum_charge, lines: signature.lines_snapshot } : null, estimateSnapshot(effectiveLines(lines, choiceFromEstimate(est, lines)), est.minimum_charge)) && (
                <div className="banner flag" style={{ marginTop: 8, marginBottom: 0 }}>
                  This estimate was changed after the customer signed it. Send it again if they need to approve the new version.
                </div>
              )}
            </div>
          )}

          {est.status !== 'draft' && (
            <div style={{ marginTop: 12 }}>
              <div className="field" style={{ marginBottom: 6 }}>
                <label>Customer link</label>
                <div className="copybox">{link}</div>
              </div>
              <button type="button" className="secondary small" onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
              {est.status === 'sent' && (
                <p className="muted" style={{ marginTop: 8 }}>
                  {est.followups_paused ? 'Follow-up reminders are stopped for this estimate.' : followupsSent > 0 ? `${followupsSent} follow-up ${followupsSent === 1 ? 'reminder' : 'reminders'} sent.` : 'No follow-up reminders sent yet.'}{' '}
                  <button type="button" className="linklike" onClick={() => updateEstimate({ followups_paused: !est.followups_paused })}>{est.followups_paused ? 'Turn reminders back on' : 'Stop reminders'}</button>
                </p>
              )}
              <p className="muted" style={{ marginTop: 8 }}>
                {est.view_count > 0 ? `Customer last viewed this ${fmtDateTime(est.last_viewed_at)} (${est.view_count} ${est.view_count === 1 ? 'view' : 'views'}).` : 'Not viewed by the customer yet.'}
              </p>
            </div>
          )}
        </div>
      )}
      {!isOffice && <p className="hint" style={{ marginTop: 10 }}>Any change you make to the lines is saved with your name and the time.</p>}
    </div>
  );
}
