'use client';

import { useEffect, useState } from 'react';
import PopupModal from '@/components/PopupModal';
import { sendVisitAction } from '@/lib/offlineActions';
import { MINUTE_CHOICES } from '@/lib/visitFlow';
import { currentToken } from '@/lib/useAuth';

// "On the way" popup: pick how many minutes out. While it is open, the phone's position is used once to ask Google for the drive
// time with current traffic, and that is offered as the top choice. The minutes can always be picked by hand instead.
// Sends the customer notification through the same status route the visit buttons use, then closes.
export default function OnTheWayModal({ open, visit, token, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [live, setLive] = useState({ state: 'idle' }); // idle | looking | ready | none

  useEffect(() => {
    if (!open || !visit?.id) { setLive({ state: 'idle' }); return undefined; }
    let alive = true;
    if (typeof navigator === 'undefined' || !navigator.geolocation || (typeof navigator.onLine === 'boolean' && !navigator.onLine)) { setLive({ state: 'none' }); return undefined; }
    setLive({ state: 'looking' });
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const t = token || await currentToken();
        const res = await fetch(`/api/visits/${visit.id}/eta`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
          body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        });
        const body = await res.json().catch(() => ({}));
        if (alive) setLive(res.ok && body.suggested ? { state: 'ready', minutes: body.minutes, suggested: body.suggested } : { state: 'none' });
      } catch { if (alive) setLive({ state: 'none' }); }
    }, () => { if (alive) setLive({ state: 'none' }); }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
    return () => { alive = false; };
  }, [open, visit?.id, token]);

  async function send(minutes, isLive = false) {
    setBusy(true);
    setMsg(null);
    try {
      await sendVisitAction({ visit, action: 'on_the_way', minutes, live: isLive });
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
      {live.state === 'looking' && <p className="hint">Checking traffic...</p>}
      {live.state === 'ready' && (
        <div style={{ marginBottom: 10 }}>
          <button type="button" className="primary big" style={{ width: '100%' }} disabled={busy} onClick={() => send(live.suggested, true)}>
            {live.suggested} min (current traffic)
          </button>
          <p className="hint" style={{ margin: '4px 0 0' }}>Drive time from where you are right now: about {live.minutes} min. Or choose your own:</p>
        </div>
      )}
      <div className="minute-grid">
        {MINUTE_CHOICES.map((m) => (
          <button key={m} type="button" className="secondary big" disabled={busy} onClick={() => send(m)}>{m} min</button>
        ))}
      </div>
    </PopupModal>
  );
}
