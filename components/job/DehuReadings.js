'use client';
// Inlet / outlet readings for one dehumidifier, with the grain depression worked out and flagged when it is low.
import { useState } from 'react';
import { addDehuReading, depressionOf, depressionState, dehuHistory, makeDehuReading, removeDehuReading, LOW_DEPRESSION, GOOD_DEPRESSION } from '@/lib/dehuReadings';
import { fmtReading } from '@/lib/moisture';

const STATE_TEXT = { low: 'Low', fair: 'Fair', ok: 'Good', none: '' };
const EMPTY = { inRh: '', inTemp: '', outRh: '', outTemp: '' };

export default function DehuReadings({ plan, unit, dayId, by, atForNow, onChange, canEdit = true }) {
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState('');
  const set = (k) => (e) => { setF((p) => ({ ...p, [k]: e.target.value })); setErr(''); };
  const live = depressionOf({ inRh: f.inRh === '' ? null : Number(f.inRh), inTemp: f.inTemp === '' ? null : Number(f.inTemp), outRh: f.outRh === '' ? null : Number(f.outRh), outTemp: f.outTemp === '' ? null : Number(f.outTemp) });
  const liveState = depressionState(live.drop);
  const hist = dehuHistory(plan, unit);
  const dayName = (id) => { const i = plan.days.findIndex((d) => d.id === id); return i < 0 ? '' : `Day ${i}`; };

  function save() {
    if (!dayId) { setErr('Add a day first.'); return; }
    const r = makeDehuReading({ day: dayId, at: atForNow ? atForNow() : null, by, ...f });
    if (!r) { setErr('Enter the humidity and temperature of the air going in, coming out, or both.'); return; }
    onChange(addDehuReading(unit, r));
    setF(EMPTY);
  }

  return (
    <div className="sk-dehu">
      {hist.length > 0 && (
        <ul className="sk-dehu-list">
          {hist.slice().reverse().map(({ r, gin, gout, drop, state }) => (
            <li key={r.id} className={`dp-${state}`}>
              <span className="sk-dehu-day">{dayName(r.day)}</span>
              <span className="sk-dehu-nums">
                In {r.inRh != null ? `${fmtReading(r.inRh)}%` : '-'} {r.inTemp != null ? `${fmtReading(r.inTemp)}°` : ''}{gin != null ? ` (${Math.round(gin)} gpp)` : ''}
                {' · '}Out {r.outRh != null ? `${fmtReading(r.outRh)}%` : '-'} {r.outTemp != null ? `${fmtReading(r.outTemp)}°` : ''}{gout != null ? ` (${Math.round(gout)} gpp)` : ''}
              </span>
              <strong className="sk-dehu-drop">{drop != null ? `${fmtReading(drop)} gr drop` : 'No drop yet'}{STATE_TEXT[state] ? ` · ${STATE_TEXT[state]}` : ''}</strong>
              {state === 'low' && <span className="sk-dehu-alert" role="alert">Under {LOW_DEPRESSION} grains: check the filter, the coils, the ducting and the room's humidity.</span>}
              {canEdit && <button type="button" className="danger small" aria-label="Delete this reading" onClick={() => onChange(removeDehuReading(unit, r.id))}>Delete</button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="sk-dehu-form">
          <div className="sk-dehu-grid">
            <label className="sk-field">Inlet RH %<input inputMode="decimal" value={f.inRh} onChange={set('inRh')} placeholder="e.g. 62" /></label>
            <label className="sk-field">Inlet temp F<input inputMode="decimal" value={f.inTemp} onChange={set('inTemp')} placeholder="e.g. 76" /></label>
            <label className="sk-field">Outlet RH %<input inputMode="decimal" value={f.outRh} onChange={set('outRh')} placeholder="e.g. 25" /></label>
            <label className="sk-field">Outlet temp F<input inputMode="decimal" value={f.outTemp} onChange={set('outTemp')} placeholder="e.g. 92" /></label>
          </div>
          {live.drop != null && <p className={`sk-dehu-live dp-${liveState}`}>Grain depression {fmtReading(live.drop)} ({STATE_TEXT[liveState]}; about {GOOD_DEPRESSION}+ is healthy)</p>}
          {err && <p className="msg err" role="alert">{err}</p>}
          <button type="button" className="secondary" onClick={save}>Save reading</button>
        </div>
      )}
    </div>
  );
}
