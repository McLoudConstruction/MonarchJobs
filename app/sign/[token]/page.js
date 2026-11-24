'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import SignaturePad from '@/components/SignaturePad';
import CenterCard from '@/components/CenterCard';
import { logoUrl } from '@/lib/branding';
import { displayPhone } from '@/lib/phone';
import { SIGN_KINDS } from '@/lib/signText';

// The customer's page to sign a work authorization or certificate of completion. No sign-in; the secret link is the access.
export default function SignPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [sig, setSig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/public/sign/${token}`).then(async (r) => {
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('This link is not available.');
      setData(b);
      setName(b.customer || '');
    }).catch((e) => setError(e.message));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (name.trim().length < 2) { setErr('Please type your full name.'); return; }
    if (!sig) { setErr('Please sign in the box.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/public/sign/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, signature: sig }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || 'Something went wrong. Please try again.');
      setDone(true);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  if (error) return <CenterCard><h2 className="auth-welcome">Link unavailable</h2><p className="hint auth-sub">{error} If you think this is a mistake, please contact the company that sent it.</p></CenterCard>;
  if (!data) return <div className="center-wrap"><p>Loading...</p></div>;
  const kind = SIGN_KINDS[data.kind] || SIGN_KINDS.authorization;
  const contact = [displayPhone(data.business.phone), data.business.email].filter(Boolean).join(' · ');
  return (
    <div className="page customer-page" style={{ maxWidth: 720 }}>
      {logoUrl(data.business.logo_path) && <img src={logoUrl(data.business.logo_path)} alt={data.business.business_name || 'Logo'} style={{ display: 'block', maxWidth: '100%', maxHeight: 110, objectFit: 'contain', margin: '0 auto 12px' }} />}
      <h1>{data.business.business_name || kind.title}</h1>
      <p className="sub">{contact}</p>
      <div className="card">
        <h2>{kind.title}</h2>
        <p className="hint">{data.address}</p>
        {data.text.map((p, i) => <p key={i}>{p}</p>)}
      </div>
      {data.signed || done ? (
        <div className="card"><h2>Thank you</h2><p>Your signature was recorded. You can close this page.</p></div>
      ) : data.closed ? (
        <div className="card"><p>This job is closed. Please contact us.</p></div>
      ) : (
        <form className="card" onSubmit={submit}>
          <div className="field"><label htmlFor="signer">Your full name</label><input id="signer" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
          <div className="field"><label>Your signature</label><SignaturePad onChange={setSig} /></div>
          {err && <div className="msg err">{err}</div>}
          <button className="primary big" style={{ width: '100%' }} disabled={busy}>{busy ? 'Submitting...' : kind.button}</button>
        </form>
      )}
    </div>
  );
}
