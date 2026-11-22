'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import {
  DAY_NAMES, DEFAULT_BOOKING, normalizeBooking, validateBookingSettings, fmtHm, countSlots, fmtSlotDayShort, fmtSlotTime,
} from '@/lib/booking';

const COLUMNS = 'timezone,booking_enabled,booking_after_sign,booking_days,booking_day_start,booking_day_end,booking_slot_minutes,booking_gap_minutes,booking_crews,booking_notice_hours,booking_window_days';
const clock = (min) => new Date(Date.UTC(2000, 0, 1, Math.floor(min / 60), min % 60)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

// Owner: the booking link, and the rules for which appointment times are offered.
export default function BookingSection() {
  const [f, setF] = useState(null);
  const [missing, setMissing] = useState(false);
  const [msg, setMsg] = useState(null);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    setLink(`${window.location.origin}/book`);
    getSupabase().from('settings').select(COLUMNS).eq('id', 1).maybeSingle().then(({ data, error }) => {
      if (error || !data) { setMissing(true); return; }
      setF({
        ...data,
        booking_day_start: String(data.booking_day_start || DEFAULT_BOOKING.booking_day_start).slice(0, 5),
        booking_day_end: String(data.booking_day_end || DEFAULT_BOOKING.booking_day_end).slice(0, 5),
      });
    });
  }, []);

  async function loadPreview() {
    try {
      const { data } = await getSupabase().auth.getSession();
      const t = data?.session?.access_token;
      const res = await fetch('/api/public/booking/slots', { headers: t ? { Authorization: `Bearer ${t}` } : {} });
      setPreview(res.ok ? await res.json() : null);
    } catch {
      setPreview(null);
    }
  }
  useEffect(() => { if (f) loadPreview(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [!!f]);

  // What the saved or typed rules would offer each day, so the owner sees the effect before saving.
  const grid = useMemo(() => (f ? normalizeBooking(f).starts : []), [f]);

  if (missing) return <div className="card"><p className="muted">This needs database update 023. Run it in Supabase, then reload.</p></div>;
  if (!f) return <div className="card"><p className="muted">Loading...</p></div>;

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const toggleDay = (n) => setF({ ...f, booking_days: f.booking_days.includes(n) ? f.booking_days.filter((d) => d !== n) : [...f.booking_days, n] });
  const slot = Number(f.booking_slot_minutes) || 0;
  const gap = Number(f.booking_gap_minutes) || 0;

  async function save(e) {
    e.preventDefault();
    const checked = validateBookingSettings(f);
    if (checked.error) { setMsg({ err: true, text: checked.error }); return; }
    const { error } = await getSupabase().from('settings').update(checked.value).eq('id', 1);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setF({ ...f, ...checked.value });
    setMsg({ text: 'Saved.' });
    loadPreview();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy this link:', link);
    }
  }

  return (
    <>
      <div className="card">
        <h2>Booking link</h2>
        <p className="hint">
          Send this link to customers. They choose a service from the price list, see the price, approve it, and pick an open time.
          Staff who open it while signed in get the in-person version (every price-list item, any kind of job, schedule later).
        </p>
        <div className="bk-link-box">
          <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Booking link" />
          <button type="button" className="primary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
          <a href="/book" target="_blank" rel="noreferrer"><button type="button" className="secondary">Open</button></a>
        </div>
        <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
          Customers only see price-list items you tick &quot;Show on the online booking page&quot; for (Settings &gt; Price list). Nothing is public until you do.
        </p>
      </div>

      <form className="card" onSubmit={save}>
        <h2>Open times</h2>
        {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <input type="checkbox" checked={!!f.booking_enabled} onChange={set('booking_enabled')} />
          Online booking page is on (customers with the link can book)
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <input type="checkbox" checked={!!f.booking_after_sign} onChange={set('booking_after_sign')} />
          After a customer signs an estimate, let them pick their own time
        </label>

        <div className="field"><label>Days we take appointments</label></div>
        <div className="bk-days">
          {DAY_NAMES.map((name, i) => (
            <label key={name}><input type="checkbox" checked={f.booking_days.includes(i + 1)} onChange={() => toggleDay(i + 1)} /> {name.slice(0, 3)}</label>
          ))}
        </div>

        <div className="grid2">
          <div className="field"><label>First appointment starts</label><input type="time" step="900" value={f.booking_day_start} onChange={set('booking_day_start')} /></div>
          <div className="field"><label>Last appointment must end by</label><input type="time" step="900" value={f.booking_day_end} onChange={set('booking_day_end')} /></div>
          <div className="field"><label>Appointment length (minutes)</label><input type="number" min="30" max="480" step="15" value={f.booking_slot_minutes} onChange={set('booking_slot_minutes')} /></div>
          <div className="field"><label>Gap between appointments (minutes)</label><input type="number" min="0" max="240" step="15" value={f.booking_gap_minutes} onChange={set('booking_gap_minutes')} /></div>
          <div className="field"><label>Jobs at the same time</label><input type="number" min="1" max="50" value={f.booking_crews} onChange={set('booking_crews')} /><div className="note">How many crews you can send at once. Each time slot closes once this many visits overlap it, whoever booked them.</div></div>
          <div className="field"><label>Minimum notice (hours)</label><input type="number" min="0" max="720" value={f.booking_notice_hours} onChange={set('booking_notice_hours')} /></div>
          <div className="field"><label>How far ahead customers can book (days)</label><input type="number" min="1" max="90" value={f.booking_window_days} onChange={set('booking_window_days')} /></div>
        </div>

        <p className="hint">
          {grid.length
            ? `Each day offers ${grid.length} appointment${grid.length === 1 ? '' : 's'}: ${grid.map(clock).join(', ')} (${slot} minutes each, ${gap} minutes apart). Times are in ${f.timezone || 'America/Chicago'}.`
            : 'With these hours no appointment fits. Widen the hours or shorten the appointment.'}
        </p>
        <button className="primary">Save booking settings</button>
      </form>

      <div className="card">
        <h2>Next open times</h2>
        {!preview && <p className="muted">Could not load the open times.</p>}
        {preview && countSlots(preview.days) === 0 && <p className="muted">No open times in the booking window.</p>}
        {preview && countSlots(preview.days) > 0 && (
          <>
            <p className="hint">What a customer would be offered right now (saved settings and the visits already on the schedule).</p>
            <ul className="bk-preview">
              {preview.days.slice(0, 5).map((d) => (
                <li key={d.date}><strong>{fmtSlotDayShort(d.date)}:</strong> {d.slots.map((s) => fmtSlotTime(s.start, preview.tz)).join(', ')}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
