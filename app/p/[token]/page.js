'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { addressLine } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { logoUrl } from '@/lib/branding';
import CenterCard from '@/components/CenterCard';

// Customer-facing photo gallery. No sign-in; the secret link is the access. Plain grid, tap to enlarge.
function GalleryView() {
  const { token } = useParams();
  const preview = useSearchParams().get('preview') === '1';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [big, setBig] = useState(null);

  useEffect(() => {
    fetch(`/api/public/photos/${token}${preview ? '?preview=1' : ''}`)
      .then(async (r) => { const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error('These photos are not available.'); setData(body); })
      .catch((e) => setError(e.message));
  }, [token, preview]);

  useEffect(() => {
    if (!big) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setBig(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big]);

  if (error) return <CenterCard><h2 className="auth-welcome">Photos unavailable</h2><p className="hint auth-sub">{error} The link may have been switched off or may have run out. Please contact us for a new one.</p></CenterCard>;
  if (!data) return <div className="center-wrap"><p>Loading...</p></div>;
  const b = data.business;
  const contact = [displayPhone(b.phone), b.email].filter(Boolean).join(' · ');
  return (
    <div className="page customer-page" style={{ maxWidth: 900 }}>
      {logoUrl(b.logo_path) && <img src={logoUrl(b.logo_path)} alt={b.business_name || 'Logo'} style={{ display: 'block', maxWidth: '100%', maxHeight: 110, objectFit: 'contain', margin: '0 0 12px' }} />}
      <h1>{b.business_name || 'Photos'}</h1>
      <p className="sub">{contact}</p>
      <div className="card">
        <h2>{data.title || 'Job photos'}</h2>
        {data.job && <p className="hint">{data.job.address ? addressLine(data.job.address) : `Job #${data.job.job_number}`}</p>}
        <div className="ph-grid">
          {data.photos.map((p) => (
            <button key={p.id} type="button" className="ph-thumb" onClick={() => setBig(p)} aria-label={p.caption || 'View photo'}>
              <img src={p.thumb_url} alt={p.caption || ''} loading="lazy" />
              {p.caption && <span className="ph-cap">{p.caption}</span>}
            </button>
          ))}
        </div>
      </div>
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

export default function Page() {
  return <Suspense fallback={<div className="center-wrap"><p>Loading...</p></div>}><GalleryView /></Suspense>;
}
