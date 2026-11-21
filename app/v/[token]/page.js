'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { addressLine } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { logoUrl } from '@/lib/branding';
import { timeText } from '@/lib/onTheWay';
import CenterCard from '@/components/CenterCard';

// Customer-facing visit status page, linked from the "on the way" text. No sign-in. Refreshes itself every 30 seconds.
export default function VisitPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () => fetch(`/api/public/visit/${token}`).then(async (r) => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('This page is not available.');
      if (alive) { setData(body); setError(''); }
    }).catch((e) => { if (alive && !data) setError(e.message); });
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (error) return <CenterCard><h2 className="auth-welcome">Page unavailable</h2><p className="hint auth-sub">{error} Please contact us if you need help.</p></CenterCard>;
  if (!data) return <div className="center-wrap"><p>Loading...</p></div>;
  const b = data.business;
  const s = data.status;
  const phone = displayPhone(b.phone);
  const contact = [phone, b.email].filter(Boolean).join(' · ');
  return (
    <div className="page customer-page" style={{ maxWidth: 560 }}>
      {logoUrl(b.logo_path) && <img src={logoUrl(b.logo_path)} alt={b.business_name || 'Logo'} style={{ display: 'block', maxWidth: '100%', maxHeight: 110, objectFit: 'contain', margin: '0 0 12px' }} />}
      <h1>{b.business_name || 'Your visit'}</h1>
      <div className="card" aria-live="polite">
        <h2 style={{ marginTop: 0 }}>{s.headline}</h2>
        {s.detail && <p>{s.detail}</p>}
        {s.step === 'scheduled' && data.starts_at && <p className="hint">Scheduled for {new Date(data.starts_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(data.time_zone ? { timeZone: data.time_zone } : {}) })} around {timeText(data.starts_at, data.time_zone || undefined)}.</p>}
        {data.job?.address && <p className="hint">{addressLine(data.job.address)}</p>}
      </div>
      <div className="card">
        <p style={{ margin: 0 }}>Need to reach us? {contact || 'Reply to the message we sent you.'}</p>
        {b.phone && <p style={{ margin: '12px 0 0' }}><a className="primary big" href={`tel:${b.phone}`} style={{ display: 'inline-block', padding: '12px 20px', textDecoration: 'none' }}>Call {phone}</a></p>}
      </div>
    </div>
  );
}
