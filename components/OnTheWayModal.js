'use client';

import { useState } from 'react';
import PopupModal from '@/components/PopupModal';
import { apiFetch } from '@/lib/useAuth';
import { MINUTE_CHOICES } from '@/lib/visitFlow';

// "On the way" popup: pick how many minutes out. Sends the customer notification through the same
// status route the visit buttons use, then closes.
export default function OnTheWayModal({ open, visit, token, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function send(minutes) {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/api/visits/${visit.id}/status`, token, { method: 'POST', body: JSON.stringify({ action: 'on_the_way', minutes }) });
      setBusy(false);
      onClose();
      onDone();
    } catch (e) {
      setMsg(e.message);
      setBusy(false);
    }
  }

  const late = visit?.status === 'on_the_way';
  return (
    <PopupModal open={open} onClose={onClose} title="On the way">
      <p className="muted" style={{ marginTop: 0 }}>
        {late ? `Currently ${visit.minutes_out} min out. Running late? Send a new time:` : 'Tell the customer how far out you are:'}
      </p>
      {msg && <div className="msg err">{msg}</div>}
      <div className="minute-grid">
        {MINUTE_CHOICES.map((m) => (
          <button key={m} type="button" className="secondary big" disabled={busy} onClick={() => send(m)}>{m} min</button>
        ))}
      </div>
    </PopupModal>
  );
}
