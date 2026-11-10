'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { logoUrl, LOGO_MAX_BYTES, LOGO_TYPES } from '@/lib/branding';

// Upload, replace or remove the business logo. Shown on the customer estimate page.
export default function BrandingSection({ token }) {
  const [path, setPath] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    getSupabase()
      .from('settings')
      .select('logo_path')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setMsg({ err: true, text: `${error.message}. If this mentions logo_path, run migration 006 in Supabase.` });
        setPath(data?.logo_path || null);
        setLoaded(true);
      });
  }, []);

  // local preview of the chosen file, released when it changes
  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(e) {
    const f = e.target.files?.[0];
    setMsg(null);
    if (!f) { setFile(null); return; }
    if (!LOGO_TYPES[f.type]) { setFile(null); setMsg({ err: true, text: 'Use a PNG, JPG or WebP image.' }); e.target.value = ''; return; }
    if (f.size > LOGO_MAX_BYTES) { setFile(null); setMsg({ err: true, text: 'That file is larger than 2 MB. Use a smaller image.' }); e.target.value = ''; return; }
    setFile(f);
  }

  function clearChoice() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const r = await apiFetch('/api/branding/logo', token, { method: 'POST', body });
      setPath(r.logo_path);
      window.dispatchEvent(new Event('branding-changed'));
      clearChoice();
      setMsg({ text: 'Logo saved.' });
    } catch (err) {
      setMsg({ err: true, text: err.message });
    }
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm('Remove the logo?')) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch('/api/branding/logo', token, { method: 'DELETE' });
      setPath(null);
      window.dispatchEvent(new Event('branding-changed'));
      setMsg({ text: 'Logo removed.' });
    } catch (err) {
      setMsg({ err: true, text: err.message });
    }
    setBusy(false);
  }

  const shown = preview || logoUrl(path);

  return (
    <div className="card">
      <h2>Logo</h2>
      <p className="hint">Shown in the app's top-left corner (in place of the Monarch Jobs text) and at the top of the estimate page your customers open. PNG, JPG or WebP, up to 2 MB. A PNG with a transparent background works best.</p>

      <div
        style={{
          minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, marginBottom: 14,
          border: '1px dashed var(--line)', borderRadius: 8,
          // light checkerboard so a transparent logo is visibly transparent
          backgroundColor: '#fff',
          backgroundImage: 'linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%),linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%)',
          backgroundSize: '16px 16px', backgroundPosition: '0 0, 8px 8px',
        }}
      >
        {!loaded ? <span className="hint">Loading...</span>
          : shown ? <img src={shown} alt="Business logo" style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain' }} />
            : <span className="hint" style={{ color: '#666' }}>No logo uploaded yet.</span>}
      </div>

      <div className="field">
        <label htmlFor="logo-file">{path ? 'Replace logo' : 'Choose a logo'}</label>
        <input id="logo-file" ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} disabled={busy} />
        {file && <div className="note">Preview only. Click Upload to save it.</div>}
      </div>

      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      <div className="row">
        <button type="button" className="primary" disabled={busy || !file} onClick={upload}>{busy ? 'Working...' : 'Upload'}</button>
        {file && <button type="button" className="secondary" disabled={busy} onClick={clearChoice}>Cancel</button>}
        <button type="button" className="danger" disabled={busy || !path || !!file} onClick={remove}>Remove logo</button>
      </div>
    </div>
  );
}
