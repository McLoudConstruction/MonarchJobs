'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { addressLine } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { logoUrl } from '@/lib/branding';
import { timeText } from '@/lib/onTheWay';
import '@/components/booking/booking.css';
import CenterCard from '@/components/CenterCard';
import SlotPicker from '@/components/booking/SlotPicker';
import { fmtSlotFull } from '@/lib/booking';

// Customer-facing visit status page, linked from the "on the way" text. No sign-in. Refreshes itself every 30 seconds.
export default function VisitPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [moving, setMoving] = useState(false); // the "pick a new time" panel is open
  const [slots, setSlots] = useState(null);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [moveMsg, setMoveMsg] = useState('');
  const [moved, setMoved] = useState(null);

  async function openMove() {
    setMoving(true); setMoveMsg(''); setSlots(null); setPicked(null);
    try {
      const r = await fetch(`/api/public/visit/${token}/reschedule`, { cache: 'no-store' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setMoveMsg(body.error || 'Times are not available right now. Please call us.'); return; }
      setSlots(body);
    } catch { setMoveMsg('Times could not be loaded. Please check your connection and try again.'); }
  }

  async function confirmMove() {
    setBusy(true); setMoveMsg('');
    try {
      const r = await fetch(`/api/public/visit/${token}/reschedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: picked }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMoveMsg(body.error || 'Something went wrong. Please try again.');
        if (body.code === 'SLOT_TAKEN') { setPicked(null); openMove(); }
        setBusy(false);
        return;
      }
      setMoved(body); setMoving(false);
      setData((d) => (d ? { ...d, starts_at: body.start, reschedule: null } : d));
    } catch { setMoveMsg('Something went wrong. Please check your connection and try again.'); }
    setBusy(false);
  }

  useEffect(() => {
    let alive = true;
    const load = () => fetch(`/api/public/visit/${token}`).then(async (r) => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('This page is not available.');
      if (alive) { setData(body); setError(''); }
    }).catch((e) => { if (alive && !data) setError(e.message); });
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (error) return <CenterCard><h2 className="auth-welcome">Page unavailable</h2><p className="hint auth-sub">{error} Please contact us if you need help.</p></CenterCard>;
  if (!data) return <div className="center-wrap"><p>Loading...</p></div>;
  const b = data.business;
  const s = data.status;
  const phone = displayPhone(b.phone);
  const contact = [phone, b.email].filter(Boolean).join(' · ');
  return (
    <div className="page customer-page" style={{ maxWidth: 560 }}>
      {logoUrl(b.logo_path) && <img src={logoUrl(b.logo_path)} alt={b.business_name || 'Logo'} style={{ display: 'block', maxWidth: '100%', maxHeight: 110, objectFit: 'contain', margin: '0 0 12px' }} />}
      <h1>{b.business_name || 'Your visit'}</h1>
      <div className="card" aria-live="polite">
        <h2 style={{ marginTop: 0 }}>{s.headline}</h2>
        {s.detail && <p>{s.detail}</p>}
        {s.step === 'scheduled' && data.starts_at && <p className="hint">Scheduled for {new Date(data.starts_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(data.time_zone ? { timeZone: data.time_zone } : {}) })} around {timeText(data.starts_at, data.time_zone || undefined)}.</p>}
        {data.job?.address && <p className="hint">{addressLine(data.job.address)}</p>}
      </div>
      {moved && <div className="card"><div className="msg ok" style={{ margin: 0 }}>Your visit is now {fmtSlotFull(moved.start, moved.end, data.time_zone || undefined)}. We sent you a message with the new time.</div></div>}
      {data.reschedule && !moved && (
        <div className="card">
          {data.reschedule.allowed ? (
            moving ? (
              <>
                <h2 style={{ marginTop: 0 }}>Pick a new time</h2>
                {!slots && !moveMsg && <p className="hint" style={{ margin: 0 }}>Loading open times...</p>}
                {slots && <SlotPicker days={slots.days} tz={slots.tz} value={picked} onPick={setPicked} empty="There are no other open times right now. Please call us and we will find one." />}
                {moveMsg && <div className="msg err">{moveMsg}</div>}
                {slots && picked && <div className="bk-picked">{fmtSlotFull(picked, slots.days.flatMap((d) => d.slots).find((x) => x.start === picked)?.end || picked, slots.tz)}</div>}
                <div className="row" style={{ marginTop: 10 }}>
                  {slots && slots.days.length > 0 && <button type="button" className="primary big" disabled={!picked || busy} onClick={confirmMove}>{busy ? 'Saving...' : 'Move my visit to this time'}</button>}
                  <button type="button" className="secondary big" disabled={busy} onClick={() => setMoving(false)}>Keep my current time</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ margin: 0 }}>Need a different time?</p>
                <p style={{ margin: '12px 0 0' }}><button type="button" className="secondary big" onClick={openMove}>Pick a new time</button></p>
              </>
            )
          ) : (
            data.reschedule.note && <p className="hint" style={{ margin: 0 }}>{data.reschedule.note}</p>
          )}
        </div>
      )}
      <div className="card">
        <p style={{ margin: 0 }}>Need to reach us? {contact || 'Reply to the message we sent you.'}</p>
        {b.phone && <p style={{ margin: '12px 0 0' }}><a className="primary big" href={`tel:${b.phone}`} style={{ display: 'inline-block', padding: '12px 20px', textDecoration: 'none' }}>Call {phone}</a></p>}
      </div>
    </div>
  );
}
