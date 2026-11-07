'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import SignaturePad from '@/components/SignaturePad';
import { estimateTotals, lineCents } from '@/lib/estimate';
import { money, addressLine, fmtDateTime, JOB_TYPES, UNIT_LABELS } from '@/lib/format';
import { displayPhone } from '@/lib/phone';

// Customer-facing estimate page. No sign-in; the secret link is the access. Stands alone, without the
// app shell. The customer can review the estimate, approve it and sign. Approving tells the office
// they are ready to be scheduled.
function Approve({ token, total, business, onDone }) {
  const [name, setName] = useState('');
  const [sig, setSig] = useState(null);
  const [times, setTimes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (name.trim().length < 2) { setErr('Please type your full name.'); return; }
    if (!sig) { setErr('Please sign in the box.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/public/estimate/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, signature: sig, preferred_times: times }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
      onDone();
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Approve this estimate</h2>
      <p className="hint">
        By signing, you approve the work and prices above for a total of <strong>{total}</strong> and ask {business || 'us'} to schedule it.
        We will contact you to confirm a time.
      </p>
      <div className="field"><label htmlFor="signer">Your full name</label><input id="signer" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
      <div className="field"><label>Your signature</label><SignaturePad onChange={setSig} /></div>
      <div className="field">
        <label htmlFor="times">Best days or times for us to come (optional)</label>
        <textarea id="times" className="sig-notes" value={times} onChange={(e) => setTimes(e.target.value)} placeholder="Weekday mornings, anytime after Thursday..." maxLength={500} />
      </div>
      {err && <div className="msg err">{err}</div>}
      <button className="primary big" style={{ width: '100%' }} disabled={busy}>{busy ? 'Submitting...' : `Approve and sign (${total})`}</button>
    </form>
  );
}

function EstimateView() {
  const { token } = useParams();
  const preview = useSearchParams().get('preview') === '1';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [justApproved, setJustApproved] = useState(false);

  const load = useCallback((isPreview) => {
    fetch(`/api/public/estimate/${token}${isPreview ? '?preview=1' : ''}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('This estimate is not available.');
        setData(body);
      })
      .catch((e) => setError(e.message));
  }, [token]);

  useEffect(() => { load(preview); }, [load, preview]);

  if (error) return <div className="center-wrap"><div className="card"><h2>Estimate unavailable</h2><p className="hint">{error} If you think this is a mistake, please contact us.</p></div></div>;
  if (!data) return <div className="center-wrap"><p>Loading...</p></div>;

  const t = estimateTotals(data.lines, data.minimum_charge);
  const total = money(t.totalCents / 100);
  const contact = [displayPhone(data.business.phone), data.business.email].filter(Boolean).join(' · ');
  return (
    <div className="page customer-page" style={{ maxWidth: 720 }}>
      <h1>{data.business.business_name || 'Estimate'}</h1>
      <p className="sub">{contact}</p>
      <div className="card">
        <h2>Estimate for {data.job?.customer}</h2>
        <p className="hint">{JOB_TYPES[data.job?.job_type]} · {addressLine(data.job?.address)}</p>
        <table className="table">
          <thead><tr><th>Service</th><th>Qty</th><th>Price</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.description}</td>
                <td>{Number(l.quantity)}</td>
                <td>{money(l.unit_price)} <span className="muted">{UNIT_LABELS[l.unit]}</span></td>
                <td style={{ textAlign: 'right' }}>{money(lineCents(l) / 100)}</td>
              </tr>
            ))}
            {t.minimumAdjustmentCents > 0 && (
              <tr><td colSpan="3">Minimum charge adjustment</td><td style={{ textAlign: 'right' }}>{money(t.minimumAdjustmentCents / 100)}</td></tr>
            )}
            <tr><th colSpan="3">Total</th><th style={{ textAlign: 'right' }}>{total}</th></tr>
          </tbody>
        </table>
        {data.job?.customer_notes && <p><strong>Notes:</strong> {data.job.customer_notes}</p>}
        {data.status === 'declined' && <div className="msg err">This estimate was declined. Please contact us if you would like a new one.</div>}
      </div>

      {data.status === 'approved' && (
        <div className="card">
          <div className="msg ok" style={{ margin: 0 }}>
            {justApproved ? 'Thank you! Your estimate is approved.' : 'This estimate has been approved.'}
            {data.signed && ` Signed by ${data.signed.signer_name} on ${fmtDateTime(data.signed.signed_at)}.`}
          </div>
          <p className="hint" style={{ marginTop: 12 }}>We will contact you shortly to confirm a time. Questions? {contact || 'Reply to the message we sent you.'}</p>
        </div>
      )}

      {data.can_accept && !preview && (
        <Approve token={token} total={total} business={data.business.business_name} onDone={() => { setJustApproved(true); load(true); }} />
      )}
      {data.can_accept && preview && (
        <div className="card"><p className="hint" style={{ margin: 0 }}>Preview: customers see an approve-and-sign form here.</p></div>
      )}
    </div>
  );
}

export default function PublicEstimatePage() {
  return <Suspense fallback={<p>Loading...</p>}><EstimateView /></Suspense>;
}
