'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/useAuth';

// Big, thumb-friendly Start / Finish buttons for a visit ("On the way" is the popup on the job header). Calls the server, which checks the tech owns the visit.
export default function VisitActions({ visit, token, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function act(action, minutes) {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/api/visits/${visit.id}/status`, token, { method: 'POST', body: JSON.stringify({ action, minutes }) });
      onDone();
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  if (visit.status === 'finished' || visit.status === 'cancelled') return null;

  return (
    <div className="field-actions">
      {msg && <div className="msg err">{msg}</div>}
      {(visit.status === 'scheduled' || visit.status === 'on_the_way') && (
        <>
          {visit.status === 'on_the_way' && <div className="muted" style={{ marginBottom: 8 }}>On the way, {visit.minutes_out} min out.</div>}
          <button className="primary big" disabled={busy} onClick={() => act('started')}>Start job</button>
        </>
      )}
      {visit.status === 'started' && (
        <button className="primary big" disabled={busy} onClick={() => { if (window.confirm('Finish this job?')) act('finished'); }}>Finish job</button>
      )}
    </div>
  );
}
