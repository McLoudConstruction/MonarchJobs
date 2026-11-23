'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { displayPhone } from '@/lib/phone';
import { logoUrl } from '@/lib/branding';
import CenterCard from '@/components/CenterCard';

// The page a friend opens from a customer's shared link: ask for a quote. No sign-in. It never says who sent it.
export default function ReferralPage() {
  const { code } = useParams();
  const [biz, setBiz] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ first_name: '', last_name: '', phone: '', email: '', street: '', zip: '', notes: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`/api/public/referral/${code}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error('This page is not available.'); setBiz(j.business); })
      .catch((e) => setError(e.message));
  }, [code]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`/api/public/referral/${code}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      setDone(true);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  if (error) return <CenterCard><h2 className="auth-welcome">Page unavailable</h2><p className="hint auth-sub">{error} Please contact us directly.</p></CenterCard>;
  if (!biz) return <div className="center-wrap"><p>Loading...</p></div>;
  const contact = [displayPhone(biz.phone), biz.email].filter(Boolean).join(' · ');

  return (
    <div className="page customer-page" style={{ maxWidth: 560 }}>
      {logoUrl(biz.logo_path) && <img src={logoUrl(biz.logo_path)} alt={biz.name || 'Logo'} style={{ display: 'block', maxWidth: '100%', maxHeight: 110, objectFit: 'contain', margin: '0 0 12px' }} />}
      <h1>{biz.name || 'Ask for a quote'}</h1>
      <p className="sub">{contact}</p>
      {done ? (
        <div className="card"><h2>Thank you</h2><p>We got your request and will contact you soon.</p></div>
      ) : (
        <form className="card" onSubmit={submit}>
          <p>A customer thought you might like a quote. Tell us how to reach you and we will be in touch.</p>
          <div className="field"><label htmlFor="rf-first">First name</label><input id="rf-first" value={f.first_name} onChange={set('first_name')} maxLength={60} required autoComplete="given-name" /></div>
          <div className="field"><label htmlFor="rf-last">Last name</label><input id="rf-last" value={f.last_name} onChange={set('last_name')} maxLength={60} autoComplete="family-name" /></div>
          <div className="field"><label htmlFor="rf-phone">Phone</label><input id="rf-phone" type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" /></div>
          <div className="field"><label htmlFor="rf-email">Email</label><input id="rf-email" type="email" value={f.email} onChange={set('email')} autoComplete="email" /></div>
          <div className="field"><label htmlFor="rf-street">Street address (optional)</label><input id="rf-street" value={f.street} onChange={set('street')} maxLength={120} autoComplete="street-address" /></div>
          <div className="field"><label htmlFor="rf-zip">ZIP (optional)</label><input id="rf-zip" value={f.zip} onChange={set('zip')} maxLength={10} autoComplete="postal-code" /></div>
          <div className="field"><label htmlFor="rf-notes">What do you need cleaned? (optional)</label><textarea id="rf-notes" className="sig-notes" rows={3} maxLength={500} value={f.notes} onChange={set('notes')} /></div>
          <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set('website')} style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
          {err && <div className="msg err">{err}</div>}
          <button className="primary big" style={{ width: '100%' }} disabled={busy}>{busy ? 'Sending...' : 'Ask for a quote'}</button>
        </form>
      )}
    </div>
  );
}
