'use client';

import { useState } from 'react';

// Floating action button for phones (hidden from 900px up, where the page has its own buttons).
// items: [{ key, label, onClick }]. onClick may be async; if it throws, the message shows in the menu.
export default function JobFab({ items }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  if (!items.length) return null;

  async function run(item) {
    setErr('');
    setBusy(item.key);
    try {
      await item.onClick();
      setOpen(false);
    } catch (e) {
      setErr(e?.message || 'That did not work. Try again.');
    }
    setBusy('');
  }

  return (
    <div className="job-fab mobile-only">
      {open && <div className="job-fab-scrim" onClick={() => { setOpen(false); setErr(''); }} role="presentation" />}
      {open && (
        <div className="job-fab-menu" role="menu">
          {err && <div className="msg err" style={{ margin: 0 }}>{err}</div>}
          {items.map((it) => (
            <button key={it.key} type="button" role="menuitem" className="job-fab-item" disabled={!!busy} onClick={() => run(it)}>
              {busy === it.key ? 'Working...' : it.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className={`job-fab-btn${open ? ' open' : ''}`}
        aria-label={open ? 'Close job actions' : 'Job actions'}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => { setOpen(!open); setErr(''); }}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
