'use client';
import { useMemo, useState } from 'react';
import { removeChamber, setChamber } from '@/lib/chambers';
import { roomTitle } from '@/lib/sketch';
import { lowDepressionUnits } from '@/lib/dehuReadings';
import { unitCode } from '@/lib/equipment';
import { CLASS_TEXT, DEFAULT_CEIL, airText, dehuText, sizePlan } from '@/lib/equipmentSizing';

const WORD = { none: 'None placed', under: 'Below what is needed', ok: 'Enough', unrated: 'Check the ratings' };

// What the loss calls for (air movers and dehumidifier capacity) next to what is on site. Advice only: it never blocks anything.
export default function EquipmentSizing({ plan, onClass, onChambers = null, canEdit = true }) {
  const [chName, setChName] = useState('');
  const [chRooms, setChRooms] = useState([]);
  const s = useMemo(() => sizePlan(plan), [plan]);
  const low = useMemo(() => lowDepressionUnits(plan), [plan]);
  if (!s.wet) return <div className="muted sk-size-empty">Draw the water on the plan (Affected areas, Water) and this will say how many air movers and how much dehumidifier it calls for.</div>;
  const d = s.dehu;
  return (
    <div className="sk-size" aria-label="Equipment needed">
      <div className={`sk-size-tile st-${s.air.status}`}>
        <div className="sk-size-head"><strong>Air movers</strong><span className="sk-size-state">{WORD[s.air.status]}</span></div>
        <div className="muted">{airText(s)}</div>
      </div>
      <div className={`sk-size-tile st-${d.status}`}>
        <div className="sk-size-head"><strong>LGR dehumidifier</strong><span className="sk-size-state">{WORD[d.status]}</span></div>
        <div className="muted">{dehuText(s)}</div>
      </div>
      {low.length > 0 && (
        <div className="sk-size-tile st-none" role="alert">
          <div className="sk-size-head"><strong>Dehumidifier not drying the air</strong></div>
          <div className="muted">{low.map((x) => `${unitCode(x.u)} (${Math.round(x.drop * 10) / 10} gr)`).join(', ')}: under 5 grains of depression on the last reading. Check the filter, coils, ducting and room humidity.</div>
        </div>
      )}
      {s.chambers.length > 0 && (
        <div className="sk-chambers">
          <strong className="sk-size-state">By chamber</strong>
          {s.chambers.map((c) => (
            <div key={c.id} className={`sk-size-tile st-${c.dehuStatus === 'under' || c.airStatus === 'under' ? 'under' : c.dehuStatus}`}>
              <div className="sk-size-head"><strong>{c.name}</strong><span className="sk-size-state">{CLASS_TEXT[c.cls]}</span></div>
              <div className="muted">{c.rooms.join(', ')}</div>
              <div className="muted">Dehumidifier: {c.pints} pints per day needed · {c.dehuNow === 0 ? 'none in it' : c.unrated ? `${c.dehuNow} in it; rate each unit` : `${c.dehuNow} in it, ${c.havePints} pints per day`}</div>
              <div className="muted">Air movers: {c.airLow}{c.airHigh !== c.airLow ? ` to ${c.airHigh}` : ''} needed · {c.airNow} in it</div>
            </div>
          ))}
        </div>
      )}
      {onChambers && canEdit && s.wet && (
        <details className="sk-more">
          <summary>Chambers ({(plan.chambers || []).length})</summary>
          <div className="sk-chamber-edit">
            <p className="muted" style={{ margin: 0 }}>A chamber is rooms that share air and are dried together. Each is sized and checked on its own.</p>
            {(plan.chambers || []).map((c) => (
              <div key={c.id} className="row"><span><strong>{c.name}</strong>: {c.rooms.map((id) => { const r = plan.rooms.find((x) => x.id === id); return r ? roomTitle(r) : ''; }).filter(Boolean).join(', ')}</span><button type="button" className="danger small" onClick={() => onChambers(removeChamber(plan.chambers, c.id))}>Remove</button></div>
            ))}
            <input aria-label="Chamber name" value={chName} maxLength={40} onChange={(e) => setChName(e.target.value)} placeholder="Name, for example Kitchen and hall" />
            <div className="sk-chamber-rooms">
              {plan.rooms.map((r) => (
                <label key={r.id} className="sk-check"><input type="checkbox" checked={chRooms.includes(r.id)} onChange={(e) => setChRooms(e.target.checked ? [...chRooms, r.id] : chRooms.filter((x) => x !== r.id))} /> {roomTitle(r)}</label>
              ))}
            </div>
            <button type="button" className="secondary small" disabled={!chRooms.length} onClick={() => { onChambers(setChamber(plan.chambers, { name: chName, rooms: chRooms })); setChName(''); setChRooms([]); }}>Make chamber</button>
          </div>
        </details>
      )}
      <label className="sk-size-class">Water class
        <select value={d.manual ? d.cls : 0} disabled={!canEdit} onChange={(e) => onClass(Number(e.target.value))}>
          <option value={0}>Automatic ({CLASS_TEXT[d.auto]}, {Math.round(d.share * 100)}% affected)</option>
          {[1, 2, 3, 4].map((c) => <option key={c} value={c}>{CLASS_TEXT[c]}{c === 4 ? ' (by hand only)' : ''}</option>)}
        </select>
      </label>
      {s.assumed > 0 && <div className="muted sk-size-note">{s.assumed === 1 ? '1 wet room has' : `${s.assumed} wet rooms have`} no ceiling height, so {DEFAULT_CEIL} ft is used. Set it on the room.</div>}
      <details className="sk-more">
        <summary>By room</summary>
        <div className="sk-size-rooms">
          {s.rooms.map((r) => <div key={r.id}><strong>{r.title}</strong><span>{r.low === r.high ? r.low : `${r.low}-${r.high}`} air mover{r.high === 1 ? '' : 's'} {'·'} {r.affected.floor} sq ft floor</span></div>)}
        </div>
      </details>
      <div className="muted sk-size-note">An estimate from the usual IICRC S500 rules of thumb. You decide what goes on the job.</div>
    </div>
  );
}
