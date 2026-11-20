'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { prepareImage } from '@/lib/photoUpload';

// "Scan receipt": take or choose a photo of a receipt, send it to the AI the owner connected (Settings > Integrations), and hand the
// details back to fill the purchase form. Nothing is saved here; a person checks the form and presses Add purchase.
// The picture is shrunk first (about 0.5 MB). It is handed back with the result so the purchase can keep it as its receipt photo.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('The picture could not be read.'));
    r.readAsDataURL(blob);
  });
}

export default function ReceiptScan({ onResult }) {
  const sb = getSupabase();
  const input = useRef(null);
  const [ready, setReady] = useState(null); // null = checking, false = no key saved
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function token() { return (await sb.auth.getSession()).data?.session?.access_token; }
  useEffect(() => {
    let live = true;
    (async () => {
      try { const r = await apiFetch('/api/ai/usage', await token()); if (live) setReady(!!r.ready); } catch { if (live) setReady(false); }
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const { fullBlob } = await prepareImage(file);
      const image = await blobToBase64(fullBlob);
      const r = await apiFetch('/api/ai/extract', await token(), { method: 'POST', body: JSON.stringify({ kind: 'receipt', media_type: 'image/jpeg', image }) });
      onResult(r.result, fullBlob);
      setMsg(r.result.warnings?.length ? { warn: true, text: r.result.warnings.join(' ') } : { text: 'Read from the receipt. Check it, then add the purchase.' });
    } catch (err) {
      setMsg({ err: true, text: err.message || 'The scan did not work.' });
    }
    setBusy(false);
  }

  if (ready === false) return <p className="hint" style={{ marginTop: 0 }}>Receipt scanning is off. Add a Claude or ChatGPT key under Settings &rsaquo; Integrations to type receipts by photo.</p>;
  return (
    <div className="receipt-scan" style={{ marginBottom: 10 }}>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={pick} aria-label="Photo of a receipt" />
      <button type="button" className="secondary" disabled={busy || ready === null} onClick={() => input.current?.click()}>{busy ? 'Reading the receipt...' : 'Scan a receipt'}</button>
      <span className="muted" style={{ marginLeft: 10 }}>Fills in the form below. You check it before it is saved.</span>
      {msg && <div className={`msg${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'} style={{ marginTop: 8 }}>{msg.text}</div>}
    </div>
  );
}
