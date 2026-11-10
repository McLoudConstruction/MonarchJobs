'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { addressLine, fmtDateTime, JOB_TYPES } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { logoUrl } from '@/lib/branding';

// Customer-facing progress update. No sign-in; the secret link is the access. Stands alone, without
// the app shell.
function UpdateView() {
  const { token } = useParams();
  const preview = useSearchParams().get('preview') === '1';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [big, setBig] = useState(null);

  useEffect(() => {
    fetch(`/api/public/update/${token}${preview ? '?preview=1' : ''}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('This update is not available.');
        setData(body);
      })
      .catch((e) => setError(e.message));
  }, [token, preview]);

  useEffect(() => {
    if (!big) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setBig(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big]);

  if (error) return <div className="center-wrap"><div className="card"><h2>Update unavailable</h2><p className="hint">{error} If you think this is a mistake, please contact us.</p></div></div>;
  if (!data) return <div className="center-wrap"><p>Loading...</p></div>;

  const b = data.business;
  const contact = [displayPhone(b.phone), b.email].filter(Boolean).join(' · ');
  return (
    <div className="page customer-page" style={{ maxWidth: 720 }}>
      {logoUrl(b.logo_path) && (
        <img src={logoUrl(b.logo_path)} alt={b.business_name || 'Logo'} style={{ display: 'block', maxWidth: '100%', maxHeight: 110, objectFit: 'contain', margin: '0 0 12px' }} />
      )}
      <h1>{b.business_name || 'Progress update'}</h1>
      <p className="sub">{contact}</p>

      <div className="card">
        <h2>{data.update.title || 'Progress update'}</h2>
        <p className="hint">
          {data.job && <>Job #{data.job.job_number} · {JOB_TYPES[data.job.job_type]} · {addressLine(data.job.address)} · </>}
          {fmtDateTime(data.update.sent_at)}
        </p>
        {data.update.body && <p className="update-body">{data.update.body}</p>}
        {data.update.next_steps && (
          <>
            <h3>What happens next</h3>
            <p className="update-body">{data.update.next_steps}</p>
          </>
        )}
      </div>

      {data.photos.length > 0 && (
        <div className="card">
          <h2>Photos</h2>
          <div className="ph-grid">
            {data.photos.map((p) => (
              <button key={p.id} type="button" className="ph-thumb" onClick={() => setBig(p)} aria-label={p.caption || 'View photo'}>
                <img src={p.thumb_url} alt={p.caption || ''} loading="lazy" />
                {p.caption && <span className="ph-cap">{p.caption}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card"><p className="hint" style={{ margin: 0 }}>Questions? {contact || 'Reply to the message we sent you.'}</p></div>

      {big && (
        <div className="pv-overlay" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setBig(null)}>
          <div className="pv-top"><span>{big.caption || ''}</span><button type="button" className="secondary small" onClick={() => setBig(null)}>Close</button></div>
          <div className="pv-stage"><img className="pv-img" src={big.url} alt={big.caption || 'Job photo'} onClick={(e) => e.stopPropagation()} /></div>
        </div>
      )}
    </div>
  );
}

export default function PublicUpdatePage() {
  return <Suspense fallback={<p>Loading...</p>}><UpdateView /></Suspense>;
}
