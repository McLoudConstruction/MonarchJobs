'use client';

import { SIZES, ADDONS, EXTRA_ROOM_PRICE, evalLines, evalTotal, fmtMoney } from '@/lib/evalSheet';
import '@/components/job/evalsheet.css';

export function Stepper({ value, onChange, min = 0, max = 99, disabled, label, suffix = '' }) {
  return (
    <span className="es-step" role="group" aria-label={label}>
      <button type="button" className="secondary" disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label={`Fewer ${label}`}>-</button>
      <span className="es-step-n">{value}{suffix ? ` ${suffix}` : ''}</span>
      <button type="button" className="secondary" disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label={`More ${label}`}>+</button>
    </span>
  );
}

// The priced part of an eval sheet: size, extra rooms, add-on services, notes, replacement flag and the running total.
// Shared by the Eval sheet tab on a job and the Evals tab on the Leads page. `set(fn)` takes a function that edits a copy of the sheet.
export default function EvalFields({ data, set, canEdit }) {
  const lines = evalLines(data);
  const total = evalTotal(data);
  return (
    <>
      <div className="card es-card">
        <h3>Size</h3>
        <div className="es-sizes" role="radiogroup" aria-label="Bedrooms">
          {SIZES.map((s) => (
            <button key={s.key} type="button" role="radio" aria-checked={data.size === s.key} disabled={!canEdit}
              className={`es-size${data.size === s.key ? ' on' : ''}`}
              onClick={() => set((d) => { d.size = d.size === s.key ? '' : s.key; return d; })}>
              <span>{s.label}</span><b>{fmtMoney(s.price).replace('.00', '')}</b>
            </button>
          ))}
        </div>
        <div className="es-line">
          <span className="es-name">Additional room(s) <span className="muted">${EXTRA_ROOM_PRICE} each</span></span>
          <Stepper value={data.extra_rooms} disabled={!canEdit} onChange={(n) => set((d) => { d.extra_rooms = n; return d; })} label="Additional rooms" />
        </div>
      </div>

      <div className="card es-card">
        <h3>Additional services</h3>
        {ADDONS.map((a) => {
          const s = data.services[a.key];
          return (
            <div key={a.key} className={`es-addon${s.on ? ' on' : ''}`}>
              <label className="es-check">
                <input type="checkbox" checked={s.on} disabled={!canEdit}
                  onChange={(e) => set((d) => { d.services[a.key].on = e.target.checked; if (e.target.checked && d.services[a.key].qty < 1) d.services[a.key].qty = 1; return d; })} />
                <span className="es-name">{a.label} <span className="muted">{a.note}</span></span>
              </label>
              {s.on && (
                <div className="es-addon-fields">
                  <Stepper value={s.qty} min={1} disabled={!canEdit} label={`${a.label} quantity`}
                    suffix={a.unit === 'each' ? '' : a.unit === 'room' ? 'rooms' : 'spots'}
                    onChange={(n) => set((d) => { d.services[a.key].qty = n; return d; })} />
                  {a.range && (
                    <label className="es-price">$<input type="number" inputMode="decimal" min="0" step="1" value={s.price} disabled={!canEdit}
                      aria-label={`${a.label} price each`}
                      onChange={(e) => set((d) => { d.services[a.key].price = e.target.value; return d; })} />
                      <span className="muted">{a.open ? 'each (150+ allowed)' : 'each'}</span></label>
                  )}
                  <b className="es-amt">{fmtMoney(s.qty * s.price)}</b>
                </div>
              )}
            </div>
          );
        })}
        {data.others.map((o, i) => (
          <div key={i} className={`es-addon${o.on ? ' on' : ''}`}>
            <label className="es-check">
              <input type="checkbox" checked={o.on} disabled={!canEdit} onChange={(e) => set((d) => { d.others[i].on = e.target.checked; return d; })} />
              <span className="es-name">Other</span>
            </label>
            <div className="es-addon-fields">
              <input className="es-other" placeholder="What was done" value={o.label} disabled={!canEdit} aria-label={`Other service ${i + 1}`}
                onChange={(e) => set((d) => { d.others[i].label = e.target.value; if (e.target.value) d.others[i].on = true; return d; })} />
              <label className="es-price">$<input type="number" inputMode="decimal" min="0" step="1" value={o.amount || ''} disabled={!canEdit}
                aria-label={`Other service ${i + 1} amount`}
                onChange={(e) => set((d) => { d.others[i].amount = e.target.value; if (e.target.value) d.others[i].on = true; return d; })} /></label>
            </div>
          </div>
        ))}
      </div>

      <div className="card es-card">
        <div className="field"><label>Notes</label>
          <textarea rows={3} value={data.notes} disabled={!canEdit} onChange={(e) => set((d) => { d.notes = e.target.value; return d; })} /></div>
        <label className="es-check es-replace">
          <input type="checkbox" checked={data.replacement} disabled={!canEdit} onChange={(e) => set((d) => { d.replacement = e.target.checked; return d; })} />
          <span className="es-name">Replacement needed</span>
        </label>
      </div>

      <div className="card es-card es-total">
        {lines.length === 0 ? <p className="muted">Pick a size or a service to start the estimate.</p> : (
          <table className="es-lines"><tbody>
            {lines.map((l) => <tr key={l.key}><td>{l.label} <span className="muted">{l.detail}</span></td><td className="r">{fmtMoney(l.amount)}</td></tr>)}
          </tbody></table>
        )}
        <div className="es-total-row"><span>Estimate total</span><b>{fmtMoney(total)}</b></div>
      </div>
    </>
  );
}
