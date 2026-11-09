'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSupabase } from '@/lib/supabaseClient';

// A plain text input with a small suggestion list under it. Suggestions come from our own server
// (/api/places/*), which holds the Google key, so no key is ever sent to the browser.
// Picking a suggestion fills in the street, city, state and ZIP through onPlaceSelected.
// If the server has no key, the field simply stays a plain input.
const DEBOUNCE_MS = 250;

async function authHeader() {
  const { data } = await getSupabase().auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

const newSession = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function PlacesAutocompleteInput({ value, onChange, onPlaceSelected, ...rest }) {
  const [enabled, setEnabled] = useState(true);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const [notice, setNotice] = useState('');
  const sessionRef = useRef(null);
  const timerRef = useRef(null);
  const reqRef = useRef(0);
  const wrapRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (!open) return undefined;
    const update = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      setRect({ top: r.bottom + 2, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  async function fetchSuggestions(text) {
    const id = ++reqRef.current;
    try {
      const headers = await authHeader();
      if (!headers) { setNotice('Address suggestions: you are not signed in. Refresh the page.'); return; }
      if (!sessionRef.current) sessionRef.current = newSession();
      const res = await fetch('/api/places/autocomplete', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text, sessionToken: sessionRef.current }),
      });
      const body = await res.json().catch(() => ({}));
      if (id !== reqRef.current) return;
      if (body.enabled === false) {
        setEnabled(false); setSuggestions([]); setOpen(false);
        setNotice('Address suggestions are off: the server has no GOOGLE_MAPS_API_KEY (add it in Vercel, then redeploy).');
        return;
      }
      if (!res.ok || body.error) setNotice(body.error || `Address suggestions failed (${res.status}).`);
      else setNotice('');
      const list = body.suggestions || [];
      setSuggestions(list);
      setOpen(list.length > 0);
    } catch {
      if (id !== reqRef.current) return;
      setNotice('Address suggestions could not reach the server.');
      setSuggestions([]);
      setOpen(false);
    }
  }

  function handleChange(e) {
    const text = e.target.value;
    onChange(e);
    if (!enabled) return;
    clearTimeout(timerRef.current);
    if (text.trim().length < 3) {
      reqRef.current++;
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(() => fetchSuggestions(text), DEBOUNCE_MS);
  }

  async function pick(s) {
    setOpen(false);
    setSuggestions([]);
    const session = sessionRef.current;
    try {
      const headers = await authHeader();
      if (!headers) return;
      const res = await fetch(`/api/places/details?placeId=${encodeURIComponent(s.placeId)}${session ? `&sessionToken=${encodeURIComponent(session)}` : ''}`, { headers });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.address) onPlaceSelected?.(body.address);
    } finally {
      sessionRef.current = null; // a session ends when a place is chosen
    }
  }

  return (
    <div ref={wrapRef}>
      <input
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
        {...rest}
      />
      {notice && <div className="note" style={{ color: 'var(--danger, #b42318)', marginTop: 3 }}>{notice}</div>}
      {open && rect && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 4000, background: '#fff',
          border: '1px solid var(--border)', borderRadius: 8, maxHeight: 260, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        }}>
          {suggestions.map((s) => (
            <div key={s.placeId} onMouseDown={() => pick(s)}
              style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{s.main}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{s.secondary}</div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
