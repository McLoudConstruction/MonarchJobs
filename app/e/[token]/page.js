'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { estimateTotals, lineCents } from '@/lib/estimate';
import { money, addressLine, JOB_TYPES, UNIT_LABELS } from '@/lib/format';

// Customer-facing estimate page. No sign-in; the secret link is the access. Stands alone, without the app shell.
function EstimateView() {
  const { token } = useParams();
  const preview = useSearchParams().get('preview') === '1';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/public/estimate/${token}${preview ? '?preview=1' : ''}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('This estimate is not available.');
        setData(body);
      })
      .catch((e) => setError(e.message));
  }, [token, preview]);

  if (error) return <div className="center-wrap"><div className="card"><h2>Estimate unavailable</h2><p className="hint">{error} If you think this is a mistake, please contact us.</p></div></div>;
  if (!data) return <div className="center-wrap"><p>Loading...</p></div>;

  const t = estimateTotals(data.lines, data.minimum_charge);
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1>{data.business.business_name || 'Estimate'}</h1>
      <p className="sub">{[data.business.phone, data.business.email].filter(Boolean).join(' · ')}</p>
      <div className="card">
        <h2>Estimate for {data.job?.customer}</h2>
        <p className="hint">{JOB_TYPES[data.job?.job_type]} · Job #{data.job?.job_number} · {addressLine(data.job?.address)}</p>
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
            <tr><th colSpan="3">Total</th><th style={{ textAlign: 'right' }}>{money(t.totalCents / 100)}</th></tr>
          </tbody>
        </table>
        {data.job?.customer_notes && <p><strong>Notes:</strong> {data.job.customer_notes}</p>}
        {data.status === 'approved' && <div className="msg ok">This estimate has been approved.</div>}
        {data.status === 'declined' && <div className="msg err">This estimate was declined.</div>}
        <p className="hint">To approve or ask a question, please call or reply to us at the number above.</p>
      </div>
    </div>
  );
}

export default function PublicEstimatePage() {
  return <Suspense fallback={<p>Loading...</p>}><EstimateView /></Suspense>;
}
