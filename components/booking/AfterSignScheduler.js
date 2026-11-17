'use client';

import { useCallback, useEffect, useState } from 'react';
import SlotPicker from './SlotPicker';
import { fmtSlotFull } from '@/lib/booking';
import './booking.css';

// Shown on the customer's estimate page right after they approve and sign: the open times, pick one, done.
// The secret estimate link is the access. If the time is taken a moment before they confirm, the list refreshes.
export default function AfterSignScheduler({ token, phone, onBooked }) {
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/estimate/${token}/slots`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Times are not available right now.'); return; }
      setSlots(body);
      setError('');
    } catch {
      setError('Times could not be loaded. Please check your connection and reload.');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function book() {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/public/estimate/${token}/schedule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: picked }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(body.error || 'Something went wrong. Please try again.');
        if (body.code === 'SLOT_TAKEN') { setPicked(null); load(); }
        setBusy(false);
        return;
      }
      onBooked(body);
    } catch {
      setMsg('Something went wrong. Please check your connection and try again.');
      setBusy(false);
    }
  }

  if (error) {
    return <div className="card"><h2>Pick a time</h2><p className="hint" style={{ margin: 0 }}>{error} We will contact you to confirm a time{phone ? `, or call us at ${phone}` : ''}.</p></div>;
  }
  if (!slots) return <div className="card"><h2>Pick a time</h2><p className="hint" style={{ margin: 0 }}>Loading open times...</p></div>;

  const chosen = picked && slots.days.flatMap((d) => d.slots).find((s) => s.start === picked);
  return (
    <div className="card">
      <h2>Pick a time</h2>
      <p className="hint">Thank you for approving. Choose a time for us to come.</p>
      <SlotPicker
        days={slots.days}
        tz={slots.tz}
        value={picked}
        onPick={setPicked}
        empty={`There are no open times right now. We will contact you to confirm a time${phone ? `, or call us at ${phone}` : ''}.`}
      />
      {msg && <div className="msg err">{msg}</div>}
      {chosen && <div className="bk-picked">{fmtSlotFull(chosen.start, chosen.end, slots.tz)}</div>}
      {slots.days.length > 0 && (
        <button type="button" className="primary big" style={{ width: '100%', minHeight: 56 }} disabled={!picked || busy} onClick={book}>
          {busy ? 'Booking...' : 'Book this time'}
        </button>
      )}
    </div>
  );
}
