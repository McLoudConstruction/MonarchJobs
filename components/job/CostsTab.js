'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { centsToText, parseMoneyToCents } from '@/lib/invoice';
import { estimateCents } from '@/lib/ownerStats';
import {
  COST_CATEGORIES, COST_CATEGORY_KEYS, costCategoryLabel, costSummary, equipmentRunTime, jobRevenue, laborTotals, parseHours,
  purchaseTotalCents, purchasesByCategory, timeEntryCents,
} from '@/lib/jobCost';
import { staffName } from '@/lib/userDisplay';
import ReceiptScan from '@/components/job/ReceiptScan';
import { prepareImage } from '@/lib/photoUpload';
import { RECEIPT_BUCKET, receiptPathFor, checkReceiptBlob } from '@/lib/receipts';
import './invoice.css';
import './costs.css';

const dateText = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const todayText = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the phone's own time zone
const newUuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
const dollars = (c) => (c == null ? '' : (Math.round(c) / 100).toFixed(2));

// Job > Costs: the owner's page. What was bought, hours worked, and equipment run time, against what the job brings in.
// Owner only (the database enforces it too). Entries are voided, never deleted.
export default function CostsTab({ jobId, sketches, staffList }) {
  const sb = getSupabase();
  const [state, setState] = useState({ loading: true, error: '' });
  const [purchases, setPurchases] = useState([]);
  const [time, setTime] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [staffRates, setStaffRates] = useState({}); // staff id -> cents per hour
  const [equipRates, setEquipRates] = useState({}); // equipment type -> cents per day
  const [showVoided, setShowVoided] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');
  const [rateOpen, setRateOpen] = useState(false);

  const load = useCallback(async () => {
    const [p, t, i, e, sr, er] = await Promise.all([
      sb.from('job_purchases').select('*').eq('job_id', jobId).order('purchased_on', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('job_time_entries').select('*').eq('job_id', jobId).order('worked_on', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('invoices').select('id,invoice_number,status,total_cents,created_at').eq('job_id', jobId),
      sb.from('estimates').select('id,status,minimum_charge,chosen_tier,lines:estimate_lines(id,quantity,unit_price,tier,optional,accepted)').eq('job_id', jobId).maybeSingle(),
      sb.from('staff_cost_rates').select('staff_id,hourly_cents'),
      sb.from('equipment_daily_rates').select('type,daily_cents'),
    ]);
    const failed = [p, t, sr, er].find((r) => r.error);
    if (failed) { setState({ loading: false, error: /does not exist|schema cache/i.test(failed.error.message) ? 'The costs tables are not set up yet. Run migration 021, then reload.' : failed.error.message }); return; }
    setPurchases(p.data || []); setTime(t.data || []); setInvoices(i.data || []); setEstimate(e.data || null);
    setStaffRates(Object.fromEntries((sr.data || []).map((r) => [r.staff_id, r.hourly_cents])));
    setEquipRates(Object.fromEntries((er.data || []).map((r) => [r.type, r.daily_cents])));
    setState({ loading: false, error: '' });
  }, [sb, jobId]);
  useEffect(() => { load(); }, [load]);

  const equipment = useMemo(() => equipmentRunTime(sketches, equipRates), [sketches, equipRates]);
  const revenue = useMemo(() => jobRevenue(invoices, estimate ? estimateCents(estimate) : null), [invoices, estimate]);
  const sum = useMemo(() => costSummary({ purchases, time, equipment, revenue }), [purchases, time, equipment, revenue]);
  const byCat = useMemo(() => purchasesByCategory(purchases), [purchases]);

  async function run(key, fn, ok) {
    setBusy(key); setMsg(null);
    try { await fn(); await load(); if (ok) setMsg({ text: ok }); return true; }
    catch (e) { setMsg({ err: true, text: e.message || 'Something went wrong.' }); return false; }
    finally { setBusy(''); }
  }
  const must = (r) => { if (r.error) throw new Error(r.error.message); };

  // ---- purchases
  const [pf, setPf] = useState({ date: todayText(), vendor: '', description: '', category: 'materials', amount: '', note: '' });
  const [receipt, setReceipt] = useState(null); // { blob, url } the picture that will be kept with the next purchase
  const [receiptUrls, setReceiptUrls] = useState({}); // path -> signed link
  useEffect(() => () => { if (receipt?.url) URL.revokeObjectURL(receipt.url); }, [receipt]);
  const receiptPaths = purchases.map((r) => r.receipt_path).filter(Boolean).join('|');
  useEffect(() => {
    const list = receiptPaths ? receiptPaths.split('|') : [];
    if (!list.length) return;
    let alive = true;
    sb.storage.from(RECEIPT_BUCKET).createSignedUrls(list, 3600).then(({ data }) => {
      if (alive) setReceiptUrls(Object.fromEntries((data || []).filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl])));
    }, () => {});
    return () => { alive = false; };
  }, [receiptPaths, sb]);
  async function keepReceipt(fileOrBlob) {
    try {
      const blob = fileOrBlob.type === 'image/jpeg' && fileOrBlob.__prepared ? fileOrBlob : (await prepareImage(fileOrBlob)).fullBlob;
      const bad = checkReceiptBlob(blob);
      if (bad) throw new Error(bad);
      setReceipt({ blob, url: URL.createObjectURL(blob) });
    } catch (e) { setMsg({ err: true, text: e.message || 'That picture could not be used.' }); }
  }
  async function uploadReceipt(blob) {
    const path = receiptPathFor(jobId, newUuid());
    const { error: upErr } = await sb.storage.from(RECEIPT_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (upErr) throw new Error(`The receipt picture did not upload (${upErr.message}). Nothing was saved. Try again.`);
    return path;
  }
  async function addReceiptTo(row, file) {
    if (!file) return;
    await run(`receipt-${row.id}`, async () => {
      const blob = (await prepareImage(file)).fullBlob;
      const bad = checkReceiptBlob(blob);
      if (bad) throw new Error(bad);
      const path = await uploadReceipt(blob);
      must(await sb.from('job_purchases').update({ receipt_path: path }).eq('id', row.id));
    }, 'Receipt added.');
  }
  async function addPurchase(e) {
    e.preventDefault();
    const cents = parseMoneyToCents(pf.amount);
    if (!pf.description.trim()) { setMsg({ err: true, text: 'Say what was bought.' }); return; }
    if (cents == null || cents < 0) { setMsg({ err: true, text: 'Enter the amount as dollars, for example 25.99.' }); return; }
    const ok = await run('purchase', async () => {
      const receipt_path = receipt ? await uploadReceipt(receipt.blob) : null; // the picture goes first: a purchase is never saved with a receipt that is missing
      must(await sb.from('job_purchases').insert({ job_id: jobId, purchased_on: pf.date || todayText(), vendor: pf.vendor.trim(), description: pf.description.trim(), category: pf.category, amount_cents: cents, note: pf.note.trim(), receipt_path }));
    }, 'Purchase added.');
    if (ok) { setPf((f) => ({ ...f, vendor: '', description: '', amount: '', note: '' })); setReceipt(null); }
  }
  async function voidRow(table, row, label) {
    const reason = window.prompt(`Void this ${label}? It stays on the list but no longer counts. Why? (optional)`, '');
    if (reason === null) return;
    await run(`void-${row.id}`, async () => must(await sb.from(table).update({ voided_at: new Date().toISOString(), void_reason: reason.trim().slice(0, 300) }).eq('id', row.id)), `${label[0].toUpperCase()}${label.slice(1)} voided.`);
  }
  async function restoreRow(table, row) {
    await run(`restore-${row.id}`, async () => must(await sb.from(table).update({ voided_at: null, void_reason: '' }).eq('id', row.id)), 'Restored.');
  }

  // ---- hours
  const people = staffList || [];
  const [tf, setTf] = useState({ staff: '', date: todayText(), hours: '', note: '' });
  const pickedRate = tf.staff && staffRates[tf.staff] != null ? staffRates[tf.staff] : null;
  async function addTime(e) {
    e.preventDefault();
    const hours = parseHours(tf.hours);
    const person = people.find((p) => p.id === tf.staff);
    if (!person) { setMsg({ err: true, text: 'Pick who worked.' }); return; }
    if (hours == null) { setMsg({ err: true, text: 'Enter the hours, for example 3.5 or 3:30 (up to 24).' }); return; }
    if (pickedRate == null) { setRateOpen(true); setMsg({ err: true, text: `Set ${staffName(person)}\u2019s hourly cost under Cost rates first (0.00 is fine), so these hours are costed right.` }); return; }
    const ok = await run('time', async () => must(await sb.from('job_time_entries').insert({ job_id: jobId, staff_id: person.id, worker_name: staffName(person), worked_on: tf.date || todayText(), hours, rate_cents: pickedRate, note: tf.note.trim() })), 'Hours added.');
    if (ok) setTf((f) => ({ ...f, hours: '', note: '' }));
  }

  // ---- rates
  async function saveStaffRate(id, text) {
    const cents = text.trim() === '' ? 0 : parseMoneyToCents(text);
    if (cents == null || cents < 0) { setMsg({ err: true, text: 'Enter the hourly cost as dollars, for example 24.50.' }); return; }
    await run(`sr-${id}`, async () => must(await sb.from('staff_cost_rates').upsert({ staff_id: id, hourly_cents: cents }, { onConflict: 'staff_id' })), 'Hourly cost saved. It applies to hours entered from now on.');
  }
  async function saveEquipRate(type, text) {
    const cents = text.trim() === '' ? 0 : parseMoneyToCents(text);
    if (cents == null || cents < 0) { setMsg({ err: true, text: 'Enter the daily cost as dollars, for example 18.00.' }); return; }
    await run(`er-${type}`, async () => must(await sb.from('equipment_daily_rates').upsert({ type, daily_cents: cents }, { onConflict: 'type' })), 'Daily cost saved.');
  }

  if (state.loading) return <div className="card"><h2>Costs</h2><p className="muted">Opening costs...</p></div>;
  if (state.error) return <div className="card"><h2>Costs</h2><div className="msg err">{state.error}</div></div>;

  const shownPurchases = purchases.filter((r) => showVoided || !r.voided_at);
  const shownTime = time.filter((r) => showVoided || !r.voided_at);
  const hasVoided = purchases.some((r) => r.voided_at) || time.some((r) => r.voided_at);
  const lab = laborTotals(time);

  return (
    <div className="cost-tab">
      <div className="card">
        <div className="inv-head">
          <div>
            <h2 style={{ margin: 0 }}>Job costs</h2>
            <div className="muted">Owner only. Nobody else can see these numbers.</div>
          </div>
          <span className="inv-chip info">{sum.totalCents > 0 ? centsToText(sum.totalCents) : '$0.00'} spent</span>
        </div>
        {msg && <div className={`msg${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'}>{msg.text}</div>}

        <div className="cost-grid">
          <div className="cost-stat"><span>Purchases</span><strong>{centsToText(sum.purchasesCents)}</strong></div>
          <div className="cost-stat"><span>Labor · {lab.hours} hr</span><strong>{centsToText(sum.laborCents)}</strong></div>
          <div className="cost-stat"><span>Equipment · {equipment.unitDays} unit-day{equipment.unitDays === 1 ? '' : 's'}</span><strong>{centsToText(sum.equipmentCents)}</strong></div>
          <div className="cost-stat total"><span>Total cost</span><strong>{centsToText(sum.totalCents)}</strong></div>
        </div>

        {revenue ? (
          <div className="inv-sums">
            <div><span>{revenue.source === 'invoice' ? `Invoice #${revenue.number}` : 'Approved estimate'}</span><span>{centsToText(revenue.cents)}</span></div>
            <div><span>Total cost</span><span>-{centsToText(sum.totalCents)}</span></div>
            <div className={`big${sum.marginCents < 0 ? ' loss' : ''}`}><span>Margin{sum.marginPercent != null ? ` (${sum.marginPercent}%)` : ''}</span><span>{sum.marginCents < 0 ? '-' : ''}{centsToText(Math.abs(sum.marginCents))}</span></div>
          </div>
        ) : <p className="hint">No invoice or approved estimate yet, so there is nothing to compare the cost against.</p>}
        {equipment.missing.length > 0 && <div className="inv-banner warn">Set a daily cost for {equipment.missing.map((t) => equipment.rows.find((r) => r.type === t)?.label).filter(Boolean).join(', ')} below, or the equipment line stays at $0.00.</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Equipment run time</h3>
        <p className="hint">Fed straight from the equipment on this job&rsquo;s sketch. Counted in calendar days on site: the day a machine is placed and the day it is picked up both count, however few hours it stood there.</p>
        {equipment.rows.length === 0 ? <p className="muted">No equipment has been placed on a sketch for this job.</p> : (
          <table className="inv-table">
            <thead><tr><th>Equipment</th><th className="num">Machines</th><th className="num">Unit-days</th><th className="num">Cost per day</th><th className="num">Cost</th></tr></thead>
            <tbody>
              {equipment.rows.map((r) => (
                <tr key={r.type}>
                  <td>{r.label}</td>
                  <td className="num">{r.units}</td>
                  <td className="num">{r.unitDays}</td>
                  <td className="num">
                    <input className="cost-rate" inputMode="decimal" aria-label={`${r.label} cost per day`} placeholder="0.00" key={`${r.type}-${equipRates[r.type] ?? ''}`} defaultValue={equipRates[r.type] ? dollars(equipRates[r.type]) : ''}
                      onBlur={(e) => { if (e.target.value.trim() !== (equipRates[r.type] ? dollars(equipRates[r.type]) : '')) saveEquipRate(r.type, e.target.value); }}
                      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  </td>
                  <td className="num"><strong>{centsToText(r.costCents)}</strong></td>
                </tr>
              ))}
              <tr><td colSpan={4}><strong>Equipment total</strong></td><td className="num"><strong>{centsToText(equipment.costCents)}</strong></td></tr>
            </tbody>
          </table>
        )}
        <p className="hint" style={{ marginBottom: 0 }}>Costs per day are set once for the whole company, so the next job uses them too.</p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Hours worked</h3>
        <form className="inv-box" onSubmit={addTime}>
          <div className="inv-row">
            <label className="field"><span>Who</span>
              <select value={tf.staff} onChange={(e) => setTf({ ...tf, staff: e.target.value })}>
                <option value="">Pick a person</option>
                {people.map((p) => <option key={p.id} value={p.id}>{staffName(p)}</option>)}
              </select>
            </label>
            <label className="field"><span>Date</span><input type="date" value={tf.date} onChange={(e) => setTf({ ...tf, date: e.target.value })} /></label>
            <label className="field"><span>Hours</span><input inputMode="decimal" placeholder="3.5 or 3:30" value={tf.hours} onChange={(e) => setTf({ ...tf, hours: e.target.value })} /></label>
            <label className="field" style={{ flex: '2 1 200px' }}><span>Note (optional)</span><input value={tf.note} maxLength={500} onChange={(e) => setTf({ ...tf, note: e.target.value })} /></label>
            <button type="submit" className="primary" disabled={busy === 'time'}>Add hours</button>
          </div>
          {tf.staff && <div className="muted" style={{ marginTop: 6 }}>{pickedRate != null ? `Costs ${centsToText(pickedRate)} an hour.` : 'No hourly cost set for this person yet. Set it under Cost rates below first.'}</div>}
        </form>
        {shownTime.length === 0 ? <p className="muted">No hours logged yet.</p> : (
          <table className="inv-table">
            <thead><tr><th>Date</th><th>Who</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Cost</th><th /></tr></thead>
            <tbody>
              {shownTime.map((r) => (
                <tr key={r.id} className={r.voided_at ? 'cost-void' : ''}>
                  <td>{dateText(r.worked_on)}</td>
                  <td>{r.worker_name || 'Former staff'}{r.note && <div className="muted">{r.note}</div>}{r.voided_at && <div className="muted">Voided{r.void_reason ? `: ${r.void_reason}` : ''}</div>}</td>
                  <td className="num">{Number(r.hours)}</td>
                  <td className="num">{centsToText(r.rate_cents)}/hr</td>
                  <td className="num">{centsToText(timeEntryCents(r))}</td>
                  <td className="num">{r.voided_at ? <button type="button" className="secondary small" onClick={() => restoreRow('job_time_entries', r)}>Restore</button> : <button type="button" className="secondary small" disabled={busy === `void-${r.id}`} onClick={() => voidRow('job_time_entries', r, 'hours entry')}>Void</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="inv-actions">
          <button type="button" className="secondary" onClick={() => setRateOpen((v) => !v)}>{rateOpen ? 'Hide cost rates' : 'Cost rates'}</button>
        </div>
        {rateOpen && (
          <div className="inv-box">
            <p className="hint" style={{ marginTop: 0 }}>What an hour of each person costs the company (wages and burden). Changing it only affects hours entered afterwards.</p>
            {people.map((p) => (
              <div className="cost-rate-row" key={p.id}>
                <span>{staffName(p)} <span className="muted">· {p.role}</span></span>
                <input className="cost-rate" inputMode="decimal" aria-label={`${staffName(p)} hourly cost`} placeholder="0.00" key={`${p.id}-${staffRates[p.id] ?? ''}`} defaultValue={staffRates[p.id] ? dollars(staffRates[p.id]) : ''}
                  onBlur={(e) => { if (e.target.value.trim() !== (staffRates[p.id] ? dollars(staffRates[p.id]) : '')) saveStaffRate(p.id, e.target.value); }}
                  onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                <span className="muted">per hour</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Purchases</h3>
        <ReceiptScan onResult={(r, blob) => { if (blob) keepReceipt(Object.assign(blob, { __prepared: true })); setPf((f) => ({
          ...f,
          date: r.date || f.date,
          vendor: r.vendor || f.vendor,
          description: r.description || f.description,
          category: r.category || f.category,
          amount: r.amountCents != null ? dollars(r.amountCents) : f.amount,
        })); }} />
        <form className="inv-box" onSubmit={addPurchase}>
          <div className="inv-row">
            <label className="field"><span>Date</span><input type="date" value={pf.date} onChange={(e) => setPf({ ...pf, date: e.target.value })} /></label>
            <label className="field"><span>Vendor</span><input value={pf.vendor} maxLength={120} onChange={(e) => setPf({ ...pf, vendor: e.target.value })} /></label>
            <label className="field" style={{ flex: '2 1 200px' }}><span>What was bought</span><input value={pf.description} maxLength={300} onChange={(e) => setPf({ ...pf, description: e.target.value })} /></label>
          </div>
          <div className="inv-row" style={{ marginTop: 8 }}>
            <label className="field"><span>Category</span>
              <select value={pf.category} onChange={(e) => setPf({ ...pf, category: e.target.value })}>{COST_CATEGORY_KEYS.map((k) => <option key={k} value={k}>{COST_CATEGORIES[k]}</option>)}</select>
            </label>
            <label className="field"><span>Amount</span><input inputMode="decimal" placeholder="25.99" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} /></label>
            <label className="field" style={{ flex: '2 1 200px' }}><span>Note (optional)</span><input value={pf.note} maxLength={500} onChange={(e) => setPf({ ...pf, note: e.target.value })} /></label>
            <button type="submit" className="primary" disabled={busy === 'purchase'}>Add purchase</button>
          </div>
          <div className="cost-receipt-pick">
            {receipt ? (
              <>
                <a href={receipt.url} target="_blank" rel="noreferrer"><img src={receipt.url} alt="Receipt picture that will be kept with this purchase" className="cost-receipt-thumb" /></a>
                <span>Receipt picture will be kept with this purchase.</span>
                <button type="button" className="secondary small" onClick={() => setReceipt(null)}>Remove</button>
              </>
            ) : (
              <label className="secondary small cost-receipt-btn">Attach receipt photo
                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) keepReceipt(f); }} />
              </label>
            )}
          </div>
        </form>
        {shownPurchases.length === 0 ? <p className="muted">No purchases logged yet.</p> : (
          <table className="inv-table">
            <thead><tr><th>Date</th><th>What</th><th>Category</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {shownPurchases.map((r) => (
                <tr key={r.id} className={r.voided_at ? 'cost-void' : ''}>
                  <td>{dateText(r.purchased_on)}</td>
                  <td>{r.description}{r.vendor && <span className="muted"> · {r.vendor}</span>}{r.note && <div className="muted">{r.note}</div>}{r.voided_at && <div className="muted">Voided{r.void_reason ? `: ${r.void_reason}` : ''}</div>}
                    {r.receipt_path ? (receiptUrls[r.receipt_path] ? <div><a href={receiptUrls[r.receipt_path]} target="_blank" rel="noreferrer">View receipt</a></div> : <div className="muted">Receipt on file</div>)
                      : <div><label className="cost-receipt-link">{busy === `receipt-${r.id}` ? 'Adding receipt...' : 'Add receipt photo'}<input type="file" accept="image/*" capture="environment" hidden disabled={busy === `receipt-${r.id}`} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; addReceiptTo(r, f); }} /></label></div>}</td>
                  <td>{costCategoryLabel(r.category)}</td>
                  <td className="num">{centsToText(r.amount_cents)}</td>
                  <td className="num">{r.voided_at ? <button type="button" className="secondary small" onClick={() => restoreRow('job_purchases', r)}>Restore</button> : <button type="button" className="secondary small" disabled={busy === `void-${r.id}`} onClick={() => voidRow('job_purchases', r, 'purchase')}>Void</button>}</td>
                </tr>
              ))}
              <tr><td colSpan={3}><strong>Purchases total</strong>{byCat.length > 1 && <span className="muted"> · {byCat.map((c) => `${c.label} ${centsToText(c.cents)}`).join(' · ')}</span>}</td><td className="num"><strong>{centsToText(purchaseTotalCents(purchases))}</strong></td><td /></tr>
            </tbody>
          </table>
        )}
        {hasVoided && <label className="cost-toggle"><input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} /> Show voided entries</label>}
      </div>
    </div>
  );
}
