'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtDateTime, toLocalInput } from '@/lib/format';

// A date and time picker that is easy to see: a bordered popup with a month calendar, tap-to-pick time
// buttons, and a Save button that applies the choice and closes it. Clicking away or Escape closes it
// without changing anything. value and onChange use the same 'YYYY-MM-DDTHH:mm' text as
// <input type="datetime-local">, so it drops in where that input was.
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTES = [0, 15, 30, 45];
const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function startingDate(value) {
  const d = value ? new Date(value) : null;
  if (d && !Number.isNaN(d.getTime())) return d;
  const n = new Date();
  n.setMinutes(Math.ceil(n.getMinutes() / 15) * 15, 0, 0);
  return n;
}

export default function DateTimeField({ value, onChange }) {
  const btn = useRef(null);
  const pop = useRef(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [draft, setDraft] = useState(() => startingDate(value));
  const [month, setMonth] = useState(() => new Date(draft.getFullYear(), draft.getMonth(), 1));
  const [pos, setPos] = useState(null);

  function openPicker() {
    const d = startingDate(value);
    setDraft(d);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setOpen(true);
  }
  const close = () => { setShown(false); setTimeout(() => setOpen(false), 140); };

  // place the popup under the field, above it if there is no room, or as a bottom sheet on a phone
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = pop.current?.offsetHeight || 470;
    if (window.innerWidth < 560) { setPos({ sheet: true }); }
    else {
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 320 - 8));
      const below = r.bottom + 6 + h <= window.innerHeight - 8;
      setPos({ left, top: below ? r.bottom + 6 : Math.max(8, r.top - h - 6) });
    }
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const onDown = (e) => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) close(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (patch) => setDraft((d) => {
    const n = new Date(d);
    if (patch.date) { n.setFullYear(patch.date.getFullYear(), patch.date.getMonth(), patch.date.getDate()); }
    if (patch.hour12 != null) { const pm = n.getHours() >= 12; n.setHours((patch.hour12 % 12) + (pm ? 12 : 0)); }
    if (patch.minute != null) n.setMinutes(patch.minute);
    if (patch.pm != null) { const h = n.getHours() % 12; n.setHours(h + (patch.pm ? 12 : 0)); }
    n.setSeconds(0, 0);
    return n;
  });

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const today = new Date();
  const hour12 = draft.getHours() % 12 === 0 ? 12 : draft.getHours() % 12;
  const pm = draft.getHours() >= 12;
  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  const style = pos?.sheet ? { left: 8, right: 8, bottom: 8 } : pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 };

  return (
    <>
      <button type="button" ref={btn} className={`dtf-input${open ? ' open' : ''}`} onClick={() => (open ? close() : openPicker())} aria-haspopup="dialog" aria-expanded={open}>
        <span>{value && !Number.isNaN(new Date(value).getTime()) ? fmtDateTime(new Date(value)) : 'Pick a date and time'}</span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      </button>
      {open && createPortal(
        <div ref={pop} className={`dtf-pop${shown ? ' in' : ''}${pos?.sheet ? ' sheet' : ''}`} style={style} role="dialog" aria-label="Pick a date and time">
          <div className="dtf-month">
            <strong>{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</strong>
            <span>
              <button type="button" aria-label="Previous month" onClick={() => shift(-1)}>&lsaquo;</button>
              <button type="button" aria-label="Next month" onClick={() => shift(1)}>&rsaquo;</button>
            </span>
          </div>
          <div className="dtf-days">
            {WEEKDAYS.map((w) => <span key={w} className="dtf-wd">{w}</span>)}
            {cells.map((d) => (
              <button
                key={d.getTime()} type="button"
                className={`dtf-day${d.getMonth() !== month.getMonth() ? ' out' : ''}${same(d, today) ? ' today' : ''}${same(d, draft) ? ' sel' : ''}`}
                onClick={() => set({ date: d })}
              >{d.getDate()}</button>
            ))}
          </div>
          <div className="dtf-time">
            <div className="dtf-hours">
              {HOURS.map((h) => <button key={h} type="button" className={h === hour12 ? 'sel' : ''} onClick={() => set({ hour12: h })}>{h}</button>)}
            </div>
            <div className="dtf-mins">
              {MINUTES.map((m) => <button key={m} type="button" className={m === draft.getMinutes() ? 'sel' : ''} onClick={() => set({ minute: m })}>:{String(m).padStart(2, '0')}</button>)}
              <button type="button" className={!pm ? 'sel' : ''} onClick={() => set({ pm: false })}>AM</button>
              <button type="button" className={pm ? 'sel' : ''} onClick={() => set({ pm: true })}>PM</button>
            </div>
          </div>
          <div className="dtf-foot">
            <button type="button" className="dtf-today" onClick={() => { set({ date: new Date() }); setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); }}>Today</button>
            <span className="dtf-sum">{fmtDateTime(draft)}</span>
          </div>
          <div className="dtf-actions">
            <button type="button" className="secondary" onClick={close}>Cancel</button>
            <button type="button" className="primary" onClick={() => { onChange(toLocalInput(draft)); close(); }}>Save</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
