'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/useAuth';

// Compact Start / Finish buttons on a visit row, for desktop. Phones use the action bar at the bottom of
// the screen instead (VisitDock). "On the way" is the popup on the job header. The server checks the tech owns the visit.
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
    <span className="visit-actions desktop-only">
      {msg && <span className="msg err" style={{ margin: 0, padding: '4px 8px' }}>{msg}</span>}
      {(visit.status === 'scheduled' || visit.status === 'on_the_way') && (
        <button type="button" className="primary small" disabled={busy} onClick={() => act('started')}>Start job</button>
      )}
      {visit.status === 'started' && (
        <button type="button" className="primary small" disabled={busy} onClick={() => { if (window.confirm('Finish this job?')) act('finished'); }}>Finish job</button>
      )}
    </span>
  );
}
