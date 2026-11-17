'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { invoiceLineCents, centsToText, PAYMENT_METHODS } from '@/lib/invoice';
import { addressLine, fmtDateTime, JOB_TYPES, UNIT_LABELS } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { logoUrl } from '@/lib/branding';
import CenterCard from '@/components/CenterCard';
import '@/components/job/invoice.css';

const dateText = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');

// Customer-facing invoice. No sign-in; the secret link is the access. Stands alone, without the app shell.
function InvoiceView() {
  const { token } = useParams();
  const q = useSearchParams();
  const preview = q.get('preview') === '1';
  const justPaid = q.get('paid') === '1';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [payErr, setPayErr] = useState('');
  const polls = useRef(0);

  const load = useCallback((isPreview) => fetch(`/api/public/invoice/${token}${isPreview ? '?preview=1' : ''}`)
    .then(async (r) => { const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error('This invoice is not available.'); setData(body); return body; })
    .catch((e) => setError(e.message)), [token]);

  useEffect(() => { load(preview); }, [load, preview]);

  // just back from paying: the payment company tells us a moment later, so look again for a minute
  useEffect(() => {
    if (!justPaid || !data || data.invoice.status === 'paid') return undefined;
    const t = setInterval(() => { polls.current += 1; if (polls.current > 15) clearInterval(t); else load(true); }, 4000);
    return () => clearInterval(t);
  }, [justPaid, data, load]);

  async function pay() {
    setBusy(true); setPayErr('');
    try {
      const res = await fetch(`/api/public/invoice/${token}/pay`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || 'Could not start the payment. Please try again.');
      window.location.href = body.url;
    } catch (e) { setPayErr(e.message); setBusy(false); }
  }

  if (error) return <CenterCard><h2 className="auth-welcome">Invoice unavailable</h2><p className="hint auth-sub">{error} If you think this is a mistake, please contact us.</p></CenterCard>;
  if (!data) return <div className="center-wrap"><p>Loading...</p></div>;

  const { invoice: inv, lines, interest, payments, photos, job, business } = data;
  const contact = [displayPhone(business.phone), business.email].filter(Boolean).join(' · ');
  const paid = inv.status === 'paid';
  const isVoid = inv.status === 'void';
  const late = !paid && !isVoid && inv.due_date && inv.due_date < new Date().toISOString().slice(0, 10);

  return (
    <div className="page customer-page" style={{ maxWidth: 720 }}>
      {logoUrl(business.logo_path) && (
        <img src={logoUrl(business.logo_path)} alt={business.business_name || 'Logo'} style={{ display: 'block', maxWidth: '100%', maxHeight: 110, objectFit: 'contain', margin: '0 0 12px' }} />
      )}
      <h1>{business.business_name || 'Invoice'}</h1>
      <p className="sub">{contact}</p>

      {justPaid && !paid && <div className="msg ok">Thank you! We are confirming your payment. This page updates by itself.</div>}
      {paid && <div className="msg ok">Paid in full{inv.paid_at ? ` on ${fmtDateTime(inv.paid_at)}` : ''}. Thank you!</div>}
      {isVoid && <div className="msg err">This invoice was cancelled and no longer needs to be paid. If you have questions, please contact us.</div>}
      {late && <div className="msg err">This invoice was due {dateText(inv.due_date)}. Please pay as soon as you can.</div>}

      <div className="card">
        <h2>Invoice #{inv.number}</h2>
        <p className="hint">
          For {inv.bill_to_name}{inv.po_number ? ` · PO ${inv.po_number}` : ''}
          {job ? <><br />{JOB_TYPES[job.job_type]} · {addressLine(job.address)}</> : null}
          {inv.issued_at ? <><br />Issued {dateText(inv.issued_at.slice(0, 10))}{inv.due_date ? ` · due ${dateText(inv.due_date)}` : ''}</> : null}
        </p>
        {inv.kind === 'difference' && <div className="inv-banner info">This invoice covers the whole job and takes off what you already paid, so only the difference is due.</div>}
        <div className="inv-scroll">
          <table className="inv-table">
            <thead><tr><th>Service</th><th>Qty</th><th>Price</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}><td>{l.description}</td><td>{Number(l.quantity)}</td><td>{centsToText(Math.round(Number(l.unit_price) * 100))} <span className="muted">{UNIT_LABELS[l.unit]}</span></td><td className="num">{centsToText(invoiceLineCents(l))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="inv-sums">
          {inv.minimum_adjustment_cents > 0 && <div><span>Minimum charge adjustment</span><span>{centsToText(inv.minimum_adjustment_cents)}</span></div>}
          <div><span>Total for the job</span><span>{centsToText(inv.total_cents)}</span></div>
          {inv.credit_cents > 0 && <div className="neg"><span>Already paid</span><span>-{centsToText(inv.credit_cents)}</span></div>}
          {interest.map((r) => <div key={r.id}><span>Late interest ({Number(r.rate_percent)}% x {r.months} month{r.months === 1 ? '' : 's'})</span><span>{centsToText(r.amount_cents)}</span></div>)}
          {inv.paid_cents !== 0 && <div className="neg"><span>Payments</span><span>-{centsToText(inv.paid_cents)}</span></div>}
          <div className="big"><span>{paid ? 'Paid' : 'Amount due'}</span><span>{centsToText(Math.max(inv.balance_cents, 0))}</span></div>
        </div>
        {inv.scope_note && <p style={{ marginTop: 14 }}><strong>Work done:</strong> {inv.scope_note}</p>}
        {payments.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {payments.map((p, i) => <div key={i} className="inv-pay"><span>{fmtDateTime(p.received_at)} · {PAYMENT_METHODS[p.method]}</span><span>{centsToText(p.amount_cents)}{p.tip_cents > 0 ? ` + ${centsToText(p.tip_cents)} tip` : ''}</span></div>)}
          </div>
        )}
      </div>

      {photos.length > 0 && (
        <div className="card">
          <h2>Pictures</h2>
          <div className="inv-pay-photos">
            {photos.map((p) => <figure key={p.id} style={{ margin: 0 }}><img src={p.thumb_url || p.url} alt={p.caption || p.kind} loading="lazy" /><figcaption className="hint" style={{ textTransform: 'capitalize' }}>{p.kind}{p.caption ? ` · ${p.caption}` : ''}</figcaption></figure>)}
          </div>
        </div>
      )}

      {data.can_pay && !preview && (
        <div className="card">
          <h2>Pay online</h2>
          <p className="hint">You will go to a secure payment page{data.tip_available ? ', where you can also add a tip if you like' : ''}. Cash or a check is fine too: just contact us.</p>
          {payErr && <div className="msg err">{payErr}</div>}
          <button className="primary big" style={{ width: '100%' }} disabled={busy} onClick={pay}>{busy ? 'Opening...' : `Pay ${centsToText(inv.balance_cents)}`}</button>
        </div>
      )}
      {data.can_pay && preview && <div className="card"><p className="hint" style={{ margin: 0 }}>Preview: customers see a Pay button here.</p></div>}
      {!data.can_pay && !paid && !isVoid && (
        <div className="card"><p className="hint" style={{ margin: 0 }}>To pay this invoice, please contact us{contact ? `: ${contact}` : ''}.</p></div>
      )}
      {business.invoice_footer && <p className="hint" style={{ whiteSpace: 'pre-wrap' }}>{business.invoice_footer}</p>}
    </div>
  );
}

export default function PublicInvoicePage() {
  return <Suspense fallback={<p>Loading...</p>}><InvoiceView /></Suspense>;
}
