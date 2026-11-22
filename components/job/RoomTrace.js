'use client';
import { useMemo, useState } from 'react';
import PopupModal from '@/components/PopupModal';
import { ROOM_TYPES, fmtFeet, parseFeet, polyArea } from '@/lib/sketch';
import { DIR_ARROW, autoCloseStep, closureGap, inchesOf, polygonFromSteps, walkSteps } from '@/lib/measure';

// Trace a room wall by wall: type what the laser says, tap the direction to walk. The last wall can close itself.
// onAdd(pts, { type, label }) puts the room on the plan (corners from 0,0) and returns true when it was added.
export default function RoomTrace({ open, onClose, onAdd }) {
  const [steps, setSteps] = useState([]);
  const [len, setLen] = useState('');
  const [type, setType] = useState('');
  const [label, setLabel] = useState('');
  const [err, setErr] = useState('');

  const gap = closureGap(steps);
  const closer = steps.length >= 2 ? autoCloseStep(steps) : null;
  const walked = useMemo(() => walkSteps(steps), [steps]);
  const done = steps.length >= 3 && gap < 0.01;
  const box = useMemo(() => {
    const xs = walked.map((p) => p[0]); const ys = walked.map((p) => p[1]);
    const x0 = Math.min(...xs); const y0 = Math.min(...ys);
    return { x0, y0, w: Math.max(...xs) - x0 || 1, h: Math.max(...ys) - y0 || 1 };
  }, [walked]);
  const sw = Math.max(box.w, box.h) / 50;

  function go(dir) {
    const ft = parseFeet(len);
    if (!Number.isFinite(ft) || ft < 0.5 || ft > 200) { setErr('Type the wall length first, like 12 or 12\'6".'); return; }
    setErr('');
    setSteps((s) => [...s, { len: ft, dir }]);
    setLen('');
  }
  function closeIt() { if (closer) setSteps((s) => [...s, closer]); }
  function reset() { setSteps([]); setLen(''); setType(''); setLabel(''); setErr(''); }
  function submit() {
    const res = polygonFromSteps(steps, 0.01);
    if (res.error) { setErr(res.error); return; }
    if (!onAdd(res.pts, { type, label })) { setErr('This sketch is full. Remove a room first.'); return; }
    reset();
    onClose();
  }
  const cancel = () => { reset(); onClose(); };

  return (
    <PopupModal open={open} onClose={cancel} title="Trace a room">
      <div className="rtr">
        <p className="muted" style={{ margin: 0 }}>Start at any corner. Type a wall length, then tap the way it runs. The arrows are as you see the sketch: up, right, down, left.</p>
        <div className="rtr-prev" aria-hidden="true">
          <svg viewBox={`${box.x0 - sw * 4} ${box.y0 - sw * 4} ${box.w + sw * 8} ${box.h + sw * 8}`} preserveAspectRatio="xMidYMid meet">
            <polyline points={walked.map((p) => p.join(',')).join(' ')} fill={done ? 'rgba(11,122,115,0.14)' : 'none'} stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={0} cy={0} r={sw * 2.2} fill="#2d7ff9" />
          </svg>
        </div>
        <div className="field"><label htmlFor="rtr-len">Wall length (feet, like 12 or 12&apos;6&quot;)</label>
          <input id="rtr-len" autoFocus inputMode="decimal" autoComplete="off" value={len} onChange={(e) => { setLen(e.target.value); setErr(''); }} placeholder="12'6&quot;" />
        </div>
        <div className="rtr-pad" role="group" aria-label="Direction of this wall">
          <button type="button" className="rtr-n" onClick={() => go('N')} aria-label="Up">{DIR_ARROW.N}</button>
          <button type="button" className="rtr-w" onClick={() => go('W')} aria-label="Left">{DIR_ARROW.W}</button>
          <button type="button" className="rtr-e" onClick={() => go('E')} aria-label="Right">{DIR_ARROW.E}</button>
          <button type="button" className="rtr-s" onClick={() => go('S')} aria-label="Down">{DIR_ARROW.S}</button>
        </div>
        {steps.length > 0 && (
          <div className="rtr-list">
            {steps.map((s, i) => <span key={i} className="rtr-chip">{fmtFeet(s.len)} {DIR_ARROW[s.dir]}</span>)}
            <button type="button" className="secondary" onClick={() => setSteps((s) => s.slice(0, -1))}>Undo last</button>
          </div>
        )}
        {steps.length > 0 && !done && (
          <div className={`rtr-gap${gap < 0.01 ? ' ok' : ''}`} role="status">
            {steps.length >= 3 && gap >= 0.01 ? `${inchesOf(gap)} in from the start.` : 'Keep going around the room.'}
            {closer && <button type="button" className="primary" onClick={closeIt}>Close with {fmtFeet(closer.len)} {DIR_ARROW[closer.dir]}</button>}
          </div>
        )}
        {done && <div className="rtr-gap ok" role="status">Closed. About {Math.round(polyArea(walked.slice(0, -1)))} sq ft.</div>}
        {done && (
          <div className="grid2">
            <div className="field"><label htmlFor="rtr-type">Room type</label>
              <select id="rtr-type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">Choose a type...</option>
                {Object.entries(ROOM_TYPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="rtr-name">Name (optional)</label>
              <input id="rtr-name" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
            </div>
          </div>
        )}
        {err && <div className="msg err" style={{ margin: 0 }}>{err}</div>}
        <div className="row">
          <button type="button" className="primary" disabled={!done} onClick={submit}>Add room</button>
          <button type="button" className="secondary" onClick={cancel}>Cancel</button>
        </div>
      </div>
    </PopupModal>
  );
}
