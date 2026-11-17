'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { useSignedUrls } from '@/lib/useSignedUrls';
import { fmtDateTime } from '@/lib/format';
import { UNIT_LABELS } from '@/lib/format';
import {
  centsToText, parseMoneyToCents, invoiceChip, invoiceLineCents, isPastDue, daysPastDue, defaultInterestMonths, interestCents,
  interestBase, interestWarning, canVoid, canReopen, PAYMENT_METHODS,
} from '@/lib/invoice';
import './invoice.css';

const dateText = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

async function call(token, method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(json.error || 'Something went wrong.'); e.code = json.code; e.body = json; throw e; }
  return json;
}

// Job > Invoice. Office and owner build, send and collect; a technician sees the balance and can take a card on site.
export default function InvoiceTab({ jobId, job, photos, staff, token, isOffice, onChanged }) {
  const sb = getSupabase();
  const [invoices, setInvoices] = useState(null);
  const [curId, setCurId] = useState(null);
  const [lines, setLines] = useState([]);
  const [payments, setPayments] = useState([]);
  const [interest, setInterest] = useState([]);
  const [attached, setAttached] = useState([]); // photo ids on the invoice, in order
  const [settings, setSettings] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');
  const [panel, setPanel] = useState(''); // '', 'cash', 'interest', 'refund', 'void', 'card', 'photos'
  const [cardLink, setCardLink] = useState(null);
  const [sendInfo, setSendInfo] = useState(null);

  const load = useCallback(async () => {
    const { data: list } = await sb.from('invoices').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
    setInvoices(list || []);
    setCurId((c) => (c && (list || []).some((i) => i.id === c) ? c : ((list || []).find((i) => i.status !== 'void') || (list || [])[0] || {}).id || null));
  }, [sb, jobId]);

  useEffect(() => { load(); sb.from('settings').select('office_can_void,late_interest_rate,late_interest_commercial_only,invoice_terms_days').eq('id', 1).maybeSingle().then(({ data }) => setSettings(data || {})); }, [load, sb]);

  const inv = useMemo(() => (invoices || []).find((i) => i.id === curId) || null, [invoices, curId]);

  const loadDetail = useCallback(async (id) => {
    if (!id) { setLines([]); setPayments([]); setInterest([]); setAttached([]); return; }
    const [l, p, i, ph] = await Promise.all([
      sb.from('invoice_lines').select('*').eq('invoice_id', id).order('sort_order'),
      sb.from('payments').select('*').eq('invoice_id', id).order('received_at'),
      isOffice ? sb.from('invoice_interest').select('*').eq('invoice_id', id).order('applied_at') : Promise.resolve({ data: [] }),
      sb.from('invoice_photos').select('photo_id,sort_order').eq('invoice_id', id).order('sort_order'),
    ]);
    setLines(l.data || []); setPayments(p.data || []); setInterest(i.data || []); setAttached((ph.data || []).map((r) => r.photo_id));
  }, [sb, isOffice]);

  useEffect(() => { loadDetail(curId); }, [curId, loadDetail]);

  // while a card payment is open, look for the result every few seconds
  useEffect(() => {
    if (!cardLink) return undefined;
    const t = setInterval(() => { load(); loadDetail(curId); }, 6000);
    return () => clearInterval(t);
  }, [cardLink, curId, load, loadDetail]);

  const refreshAll = useCallback(async () => { await load(); await loadDetail(curId); onChanged?.(); }, [load, loadDetail, curId, onChanged]);

  async function run(key, fn, okText) {
    setBusy(key); setMsg(null);
    try { const r = await fn(); await refreshAll(); if (okText) setMsg({ text: typeof okText === 'function' ? okText(r) : okText }); return r; }
    catch (e) { setMsg({ err: true, text: e.message }); return null; }
    finally { setBusy(''); }
  }

  const photoById = useMemo(() => new Map((photos || []).map((p) => [p.id, p])), [photos]);
  const attachedPhotos = attached.map((id) => photoById.get(id)).filter(Boolean);
  const pairable = (photos || []).filter((p) => !p.archived_at);
  const urls = useSignedUrls([...attachedPhotos, ...(panel === 'photos' ? pairable.slice(0, 60) : [])].map((p) => p.thumb_path || p.storage_path));

  if (!invoices) return <div className="card"><h2>Invoice</h2><p className="muted">Loading...</p></div>;

  const isDraft = inv?.status === 'draft';
  const open = inv && (inv.status === 'sent' || inv.status === 'partial');
  const chip = invoiceChip(inv);
  const pastDue = isPastDue(inv);
  const customerType = job?.customer?.customer_type;
  const mayVoid = canVoid(staff.role, settings.office_can_void);
  const jobDone = ['completed', 'closed'].includes(job?.status);
  const hasLive = (invoices || []).some((i) => i.status !== 'void');

  // ---------------------------------------------------------------- actions
  const createInvoice = () => run('create', async () => { const r = await call(token, 'POST', `/api/jobs/${jobId}/invoice`); setCurId(r.id); return r; }, 'Invoice created from the estimate.');
  const rebuild = () => run('rebuild', () => call(token, 'POST', `/api/invoices/${inv.id}/refresh`), 'Rebuilt from the estimate.');
  const saveField = (field, value) => run('field', () => call(token, 'PATCH', `/api/invoices/${inv.id}`, { [field]: value }));

  async function saveLine(l, patch) {
    const { error } = await sb.from('invoice_lines').update(patch).eq('id', l.id);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    await refreshAll();
  }
  async function addLine() {
    const { error } = await sb.from('invoice_lines').insert({ invoice_id: inv.id, description: 'Additional charge', unit: 'flat', quantity: 1, unit_price: 0, is_custom: true, sort_order: lines.length + 1 });
    if (error) { setMsg({ err: true, text: error.message }); return; }
    await refreshAll();
  }
  async function removeLine(l) {
    const { error } = await sb.from('invoice_lines').delete().eq('id', l.id);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    await refreshAll();
  }
  async function togglePhoto(id) {
    const on = attached.includes(id);
    const { error } = on
      ? await sb.from('invoice_photos').delete().eq('invoice_id', inv.id).eq('photo_id', id)
      : await sb.from('invoice_photos').insert({ invoice_id: inv.id, photo_id: id, sort_order: attached.length + 1 });
    if (error) { setMsg({ err: true, text: error.message }); return; }
    await loadDetail(inv.id);
  }

  const send = (resend) => run('send', async () => {
    const r = await call(token, 'POST', `/api/invoices/${inv.id}/send`, {});
    setSendInfo(r);
    if (!r.ok) throw new Error(`Nothing went out. ${[r.results?.sms?.detail, r.results?.email?.detail].filter(Boolean).join(' ')} You can copy the link and send it yourself, then mark the invoice as sent.`);
    return r;
  }, (r) => `${resend ? 'Sent again' : 'Sent'}: ${[r.results.sms.status === 'sent' && 'text', r.results.email.status === 'sent' && 'email'].filter(Boolean).join(' and ')}.`);
  const markSent = () => run('send', async () => { const r = await call(token, 'POST', `/api/invoices/${inv.id}/send`, { manual: true }); setSendInfo(r); return r; }, 'Marked as sent. Share the link with the customer.');

  const payCard = () => run('card', async () => { const r = await call(token, 'POST', `/api/invoices/${inv.id}/pay-link`, { provider: 'stripe' }); setCardLink(r); setPanel('card'); return r; });
  const sendPayLink = () => run('square', async () => { const r = await call(token, 'POST', `/api/invoices/${inv.id}/pay-link`, { provider: 'square', deliver: true }); if (!r.delivery?.delivered) throw new Error(`The link was made but nothing went out. ${[r.delivery?.sms?.detail, r.delivery?.email?.detail].filter(Boolean).join(' ')}`); return r; }, 'Payment link sent (the customer can add a tip).');

  // ---------------------------------------------------------------- forms
  function CashForm() {
    const [method, setMethod] = useState('check'); const [amt, setAmt] = useState((inv.balance_cents / 100).toFixed(2)); const [ref, setRef] = useState(''); const [note, setNote] = useState('');
    const submit = async (e) => {
      e.preventDefault();
      const attempt = (confirm_over) => call(token, 'POST', `/api/invoices/${inv.id}/payment`, { method, amount: amt, reference: ref, note, confirm_over });
      const r = await run('cash', async () => {
        try { return await attempt(false); }
        catch (err) { if (err.code === 'OVER_BALANCE' && window.confirm(`${err.message}\n\nRecord it anyway?`)) return attempt(true); throw err; }
      }, 'Payment recorded.');
      if (r) setPanel('');
    };
    return (
      <form className="inv-box" onSubmit={submit}>
        <div className="inv-row">
          <div className="field"><label>Received by</label><select value={method} onChange={(e) => setMethod(e.target.value)}><option value="check">Check</option><option value="cash">Cash</option><option value="other">Other</option></select></div>
          <div className="field"><label>Amount</label><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          {method === 'check' && <div className="field"><label>Check number</label><input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} /></div>}
        </div>
        <div className="field" style={{ marginTop: 10 }}><label>Note (optional)</label><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
        <div className="inv-actions"><button className="primary" disabled={busy === 'cash'}>{busy === 'cash' ? 'Saving...' : 'Record payment'}</button><button type="button" className="secondary" onClick={() => setPanel('')}>Cancel</button></div>
      </form>
    );
  }

  function InterestForm() {
    const [rate, setRate] = useState(String(settings.late_interest_rate ?? 1.5)); const [months, setMonths] = useState(String(defaultInterestMonths(inv) || 1)); const [note, setNote] = useState('');
    const base = interestBase(inv);
    const amt = interestCents(base, Number(rate), Number(months));
    const submit = async (e) => {
      e.preventDefault();
      const warn = interestWarning(customerType, settings.late_interest_commercial_only);
      if (warn && !window.confirm(warn)) return;
      const r = await run('interest', () => call(token, 'POST', `/api/invoices/${inv.id}/interest`, { rate: Number(rate), months: Number(months), note }), `Added ${centsToText(amt)} late interest.`);
      if (r) setPanel('');
    };
    return (
      <form className="inv-box" onSubmit={submit}>
        <p className="hint" style={{ marginTop: 0 }}>Simple interest per month on the unpaid amount ({centsToText(base)}). It is added to the balance and shown to the customer. It is never added automatically.</p>
        <div className="inv-row">
          <div className="field"><label>Rate per month (%)</label><input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          <div className="field"><label>Months</label><input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></div>
        </div>
        <div className="field" style={{ marginTop: 10 }}><label>Note (optional)</label><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></div>
        <p style={{ margin: '10px 0 0' }}><strong>Interest to add: {centsToText(amt)}</strong></p>
        <div className="inv-actions"><button className="primary" disabled={busy === 'interest' || amt < 1}>{busy === 'interest' ? 'Adding...' : 'Add late interest'}</button><button type="button" className="secondary" onClick={() => setPanel('')}>Cancel</button></div>
      </form>
    );
  }

  function RefundForm() {
    const [amt, setAmt] = useState(''); const [note, setNote] = useState('');
    const submit = async (e) => { e.preventDefault(); const r = await run('refund', () => call(token, 'POST', `/api/invoices/${inv.id}/refund`, { amount: amt, note }), 'Refund recorded.'); if (r) setPanel(''); };
    return (
      <form className="inv-box" onSubmit={submit}>
        <p className="hint" style={{ marginTop: 0 }}>For money handed back in cash or by check. Card refunds are made in Stripe or Square and appear here by themselves.</p>
        <div className="inv-row"><div className="field"><label>Amount refunded</label><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></div><div className="field"><label>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div></div>
        <div className="inv-actions"><button className="primary" disabled={busy === 'refund'}>Record refund</button><button type="button" className="secondary" onClick={() => setPanel('')}>Cancel</button></div>
      </form>
    );
  }

  function VoidForm() {
    const [reason, setReason] = useState('');
    const submit = async (e) => { e.preventDefault(); const r = await run('void', () => call(token, 'POST', `/api/invoices/${inv.id}/void`, { reason }), 'Invoice voided. Its payment links no longer work.'); if (r) setPanel(''); };
    return (
      <form className="inv-box" onSubmit={submit}>
        <p className="hint" style={{ marginTop: 0 }}>Voiding keeps the record but it no longer counts as money owed, and any card or payment link for it is cancelled. An invoice with payments on it cannot be voided.</p>
        <div className="field"><label>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Made in error, customer cancelled..." /></div>
        <div className="inv-actions"><button className="danger" disabled={busy === 'void'}>Void invoice</button><button type="button" className="secondary" onClick={() => setPanel('')}>Cancel</button></div>
      </form>
    );
  }

  async function reopen() {
    const reason = window.prompt('Reopen this job for a return visit? Say why (optional). When it is finished again, the invoice is updated: an unpaid one is voided and billed again in full, a paid one gets a second invoice for only the difference.', '');
    if (reason === null) return;
    await run('reopen', () => call(token, 'POST', `/api/jobs/${jobId}/reopen`, { reason }), 'Job reopened. Schedule the return visit.');
  }

  // ---------------------------------------------------------------- view
  return (
    <>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`} role="status">{msg.text}</div>}

      {invoices.length === 0 && (
        <div className="card">
          <h2>Invoice</h2>
          <p className="muted">There is no invoice for this job yet.{isOffice ? ' It is made from the approved estimate, with the before and after pictures and payment options attached.' : ''}</p>
          {isOffice && <button className="primary" disabled={busy === 'create'} onClick={createInvoice}>{busy === 'create' ? 'Creating...' : 'Create invoice from estimate'}</button>}
        </div>
      )}

      {invoices.length > 1 && (
        <div className="card">
          <h2>Invoices on this job</h2>
          <div className="inv-pick">
            {invoices.map((i) => { const c = invoiceChip(i); return (
              <button key={i.id} type="button" className={`secondary ${i.id === curId ? 'on' : ''}`} onClick={() => { setCurId(i.id); setPanel(''); setCardLink(null); }}>
                #{i.invoice_number} <span className={`inv-chip ${c.tone}`}>{c.label}</span> <span>{centsToText(i.total_cents)}</span>
              </button>); })}
          </div>
        </div>
      )}

      {inv && (
        <div className="card">
          <div className="inv-head">
            <div>
              <h2 style={{ marginBottom: 2 }}>Invoice #{inv.invoice_number} <span className={`inv-chip ${chip.tone}`}>{chip.label}</span></h2>
              <p className="hint" style={{ margin: 0 }}>
                {inv.bill_to_name}{inv.po_number ? ` · PO ${inv.po_number}` : ''}
                {inv.issued_at ? ` · sent ${fmtDateTime(inv.issued_at)}` : ''}{inv.due_date ? ` · due ${dateText(inv.due_date)}` : ''}
              </p>
              {inv.first_viewed_at && <p className="hint" style={{ margin: 0 }}>Customer opened it {fmtDateTime(inv.first_viewed_at)}{inv.view_count > 1 ? ` (${inv.view_count} times)` : ''}.</p>}
            </div>
            {inv.status !== 'draft' && <a className="button secondary" href={`/i/${inv.share_token}?preview=1`} target="_blank" rel="noreferrer">What the customer sees</a>}
          </div>

          {inv.kind === 'difference' && <div className="inv-banner info">Return visit: this invoice lists the whole job and takes off the {centsToText(inv.credit_cents)} already paid, so only the difference is due.</div>}
          {inv.status === 'void' && <div className="inv-banner warn">Voided{inv.void_reason ? `: ${inv.void_reason}` : ''}. {inv.superseded_by ? `Replaced by a newer invoice.` : ''}</div>}
          {pastDue && <div className="inv-banner bad">Past due by {daysPastDue(inv)} day{daysPastDue(inv) === 1 ? '' : 's'}. {centsToText(inv.balance_cents)} is still owed.</div>}
          {inv.disputed_at && <div className="inv-banner bad">The customer disputed a payment on this invoice. Respond in Stripe or Square.</div>}
          {isDraft && isOffice && <div className="inv-banner warn">Draft. The customer cannot see it until you send it. Check the lines, then send.</div>}

          <div className="inv-scroll">
            <table className="inv-table">
              <thead><tr><th>Description</th><th>Qty</th><th>Price</th><th className="num">Amount</th>{isDraft && isOffice && <th />}</tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    {isDraft && isOffice ? (
                      <>
                        <td><input defaultValue={l.description} onBlur={(e) => e.target.value.trim() && e.target.value !== l.description && saveLine(l, { description: e.target.value.trim() })} /></td>
                        <td><input className="q" inputMode="decimal" defaultValue={Number(l.quantity)} onBlur={(e) => Number(e.target.value) !== Number(l.quantity) && Number(e.target.value) >= 0 && saveLine(l, { quantity: Number(e.target.value) })} /></td>
                        <td><input className="p" inputMode="decimal" defaultValue={Number(l.unit_price)} onBlur={(e) => Number(e.target.value) !== Number(l.unit_price) && Number.isFinite(Number(e.target.value)) && saveLine(l, { unit_price: Number(e.target.value) })} /></td>
                      </>
                    ) : (
                      <><td>{l.description}</td><td>{Number(l.quantity)}</td><td>{centsToText(Math.round(Number(l.unit_price) * 100))} <span className="muted">{UNIT_LABELS[l.unit]}</span></td></>
                    )}
                    <td className="num">{centsToText(invoiceLineCents(l))}</td>
                    {isDraft && isOffice && <td><button type="button" className="secondary small" aria-label="Remove line" onClick={() => removeLine(l)}>x</button></td>}
                  </tr>
                ))}
                {lines.length === 0 && <tr><td colSpan="5" className="muted">No lines.</td></tr>}
              </tbody>
            </table>
          </div>
          {isDraft && isOffice && (
            <div className="inv-actions">
              <button type="button" className="secondary" onClick={addLine}>Add a line</button>
              <button type="button" className="secondary" disabled={busy === 'rebuild'} onClick={() => window.confirm('Rebuild the lines from the estimate? Changes you made to the lines here are replaced.') && rebuild()}>Rebuild from estimate</button>
            </div>
          )}

          <div className="inv-sums">
            <div><span>Subtotal</span><span>{centsToText(inv.subtotal_cents)}</span></div>
            {inv.minimum_adjustment_cents > 0 && <div><span>Minimum charge adjustment</span><span>{centsToText(inv.minimum_adjustment_cents)}</span></div>}
            {inv.credit_cents > 0 && <div className="neg"><span>Already paid (earlier invoice)</span><span>-{centsToText(inv.credit_cents)}</span></div>}
            {interest.filter((r) => !r.waived_at).map((r) => (
              <div key={r.id}><span>Late interest ({Number(r.rate_percent)}% x {r.months} mo){staff.role === 'owner' && open ? <> <button type="button" className="secondary small" onClick={() => window.confirm('Waive this interest?') && run('waive', () => call(token, 'DELETE', `/api/invoices/${inv.id}/interest/${r.id}`), 'Interest waived.')}>Waive</button></> : null}</span><span>{centsToText(r.amount_cents)}</span></div>
            ))}
            {inv.paid_cents !== 0 && <div className="neg"><span>Payments</span><span>-{centsToText(inv.paid_cents)}</span></div>}
            {inv.tip_cents > 0 && <div className="muted"><span>Tip (not part of the invoice)</span><span>{centsToText(inv.tip_cents)}</span></div>}
            <div className="big"><span>{inv.status === 'paid' ? 'Paid in full' : 'Balance due'}</span><span>{centsToText(Math.max(inv.balance_cents, 0))}</span></div>
          </div>

          {isDraft && isOffice && (
            <div className="inv-box">
              <div className="inv-row">
                <div className="field" style={{ flex: '2 1 260px' }}><label>Bill to</label><input defaultValue={inv.bill_to_name} onBlur={(e) => e.target.value !== inv.bill_to_name && saveField('bill_to_name', e.target.value)} /></div>
                <div className="field"><label>PO number</label><input defaultValue={inv.po_number} onBlur={(e) => e.target.value !== inv.po_number && saveField('po_number', e.target.value)} /></div>
                <div className="field"><label>Payment due in (days)</label><input inputMode="numeric" defaultValue={inv.terms_days} onBlur={(e) => Number(e.target.value) !== inv.terms_days && saveField('terms_days', e.target.value)} /></div>
              </div>
              <div className="inv-row" style={{ marginTop: 10 }}>
                <div className="field"><label>Email</label><input defaultValue={inv.bill_to_email} onBlur={(e) => e.target.value !== inv.bill_to_email && saveField('bill_to_email', e.target.value)} /></div>
                <div className="field"><label>Mobile</label><input defaultValue={inv.bill_to_phone} onBlur={(e) => e.target.value !== inv.bill_to_phone && saveField('bill_to_phone', e.target.value)} /></div>
              </div>
              <div className="field" style={{ marginTop: 10 }}><label>Scope of work shown on the invoice</label><textarea rows={3} defaultValue={inv.scope_note} maxLength={4000} onBlur={(e) => e.target.value !== inv.scope_note && saveField('scope_note', e.target.value)} /></div>
            </div>
          )}
          {!isDraft && inv.scope_note && <p style={{ marginTop: 12 }}><strong>Scope of work:</strong> {inv.scope_note}</p>}

          {(attachedPhotos.length > 0 || (isDraft && isOffice)) && (
            <div style={{ marginTop: 12 }}>
              <strong>Pictures sent with the invoice</strong>
              <div className="inv-photos">
                {attachedPhotos.map((p) => (
                  <div className="ph" key={p.id}>
                    {urls[p.thumb_path || p.storage_path] && <img src={urls[p.thumb_path || p.storage_path]} alt={p.caption || p.kind} />}
                    <span className="tag">{p.kind}</span>
                    {isDraft && isOffice && <button type="button" className="secondary" aria-label="Remove picture" onClick={() => togglePhoto(p.id)}>x</button>}
                  </div>
                ))}
                {attachedPhotos.length === 0 && <span className="muted">None attached. Before and after pairs are added automatically.</span>}
              </div>
              {isDraft && isOffice && <div className="inv-actions"><button type="button" className="secondary" onClick={() => setPanel(panel === 'photos' ? '' : 'photos')}>{panel === 'photos' ? 'Done choosing' : 'Choose pictures'}</button></div>}
              {panel === 'photos' && (
                <div className="inv-photos">
                  {pairable.slice(0, 60).map((p) => (
                    <button key={p.id} type="button" className="ph secondary" style={{ padding: 0, outline: attached.includes(p.id) ? '3px solid var(--accent)' : 'none' }} onClick={() => togglePhoto(p.id)}>
                      {urls[p.thumb_path || p.storage_path] && <img src={urls[p.thumb_path || p.storage_path]} alt={p.caption || p.kind} />}
                      <span className="tag">{p.kind}{attached.includes(p.id) ? ' ✓' : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ---- send / collect */}
          {isOffice && isDraft && (
            <div className="inv-actions">
              <button type="button" className="primary" disabled={busy === 'send' || lines.length === 0} onClick={() => send(false)}>{busy === 'send' ? 'Sending...' : 'Send to customer'}</button>
              <button type="button" className="secondary" disabled={busy === 'send'} onClick={() => window.confirm('Mark this as sent without texting or emailing it? Use this when you gave or sent it another way.') && markSent()}>I sent it myself</button>
            </div>
          )}
          {isDraft && inv.balance_cents > 0 && (
            <div className="inv-actions">
              <button type="button" className="secondary" disabled={busy === 'card'} onClick={payCard}>Customer pays now (card)</button>
              {isOffice && <button type="button" className="secondary" onClick={() => setPanel(panel === 'cash' ? '' : 'cash')}>Record cash or check</button>}
            </div>
          )}
          {open && (
            <div className="inv-actions">
              <button type="button" className="primary" disabled={busy === 'card'} onClick={payCard}>Customer pays now (card)</button>
              {isOffice && <button type="button" className="secondary" disabled={busy === 'square'} onClick={sendPayLink}>{busy === 'square' ? 'Sending...' : 'Send payment link (with tip)'}</button>}
              {isOffice && <button type="button" className="secondary" onClick={() => setPanel(panel === 'cash' ? '' : 'cash')}>Record cash or check</button>}
              {isOffice && <button type="button" className="secondary" disabled={busy === 'send'} onClick={() => send(true)}>{pastDue ? 'Send reminder' : 'Send again'}</button>}
              {staff.role === 'owner' && pastDue && <button type="button" className="secondary" onClick={() => setPanel(panel === 'interest' ? '' : 'interest')}>Add late interest</button>}
            </div>
          )}
          {panel === 'cash' && inv.balance_cents > 0 && <CashForm />}
          {panel === 'interest' && <InterestForm />}
          {panel === 'refund' && <RefundForm />}
          {panel === 'void' && <VoidForm />}
          {panel === 'card' && cardLink && (
            <div className="inv-box">
              <strong>Hand the phone to the customer</strong>
              <p className="hint" style={{ margin: '4px 0' }}>They pay by card on the payment company&apos;s secure page. This invoice updates here by itself when it goes through.</p>
              <div className="inv-actions" style={{ marginTop: 6 }}>
                <a className="button primary" href={cardLink.url} target="_blank" rel="noreferrer">Open card payment</a>
                <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(cardLink.url)}>Copy link</button>
                <button type="button" className="secondary" onClick={() => { setCardLink(null); setPanel(''); }}>Close</button>
              </div>
            </div>
          )}
          {sendInfo?.link && (
            <div className="inv-box">
              <strong>Invoice link</strong>
              <div className="inv-linkbox">{sendInfo.link}</div>
              <button type="button" className="secondary small" onClick={() => navigator.clipboard?.writeText(sendInfo.link)}>Copy link</button>
            </div>
          )}

          {payments.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <strong>Payments</strong>
              {payments.map((p) => (
                <div key={p.id} className="inv-pay">
                  <span>{fmtDateTime(p.received_at)} · {PAYMENT_METHODS[p.method]}{p.reference ? ` #${p.reference}` : ''}{p.note ? ` · ${p.note}` : ''}</span>
                  <span style={{ color: p.amount_cents < 0 ? '#8a1f14' : undefined }}><strong>{centsToText(p.amount_cents)}</strong>{p.tip_cents > 0 ? ` + ${centsToText(p.tip_cents)} tip` : ''}</span>
                </div>
              ))}
              {staff.role === 'owner' && payments.some((p) => ['cash', 'check', 'other'].includes(p.method) && p.amount_cents > 0) && inv.status !== 'void' && (
                <div className="inv-actions"><button type="button" className="secondary small" onClick={() => setPanel(panel === 'refund' ? '' : 'refund')}>Record a cash or check refund</button></div>
              )}
            </div>
          )}

          {isOffice && inv.status !== 'void' && payments.length === 0 && mayVoid && (
            <div className="inv-actions"><button type="button" className="secondary small" onClick={() => setPanel(panel === 'void' ? '' : 'void')}>Void this invoice</button></div>
          )}
          {isOffice && jobDone && inv.status !== 'void' && canReopen(staff.role, settings.office_can_void) && (
            <div className="inv-actions"><button type="button" className="secondary small" disabled={busy === 'reopen'} onClick={reopen}>Reopen job for a return visit</button></div>
          )}
        </div>
      )}

      {isOffice && invoices.length > 0 && !hasLive && jobDone && (
        <div className="card"><p className="muted" style={{ marginTop: 0 }}>Every invoice on this job was voided.</p><button className="primary" disabled={busy === 'create'} onClick={createInvoice}>Create a new invoice</button></div>
      )}
    </>
  );
}
