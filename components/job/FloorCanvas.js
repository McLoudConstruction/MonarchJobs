'use client';

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SketchCanvas from '@/components/job/SketchCanvas';
import { normalizePlan, planBounds } from '@/lib/sketch';
import { addFloor, addStairs, floorSlots, currentFloor, floorIsEmpty, floorView, mergeFloor, removeFloor, renameFloor, MAX_FLOORS } from '@/lib/floors';
import { makeObject } from '@/lib/objectTypes';
import './floors.css';

// Floors around the drawing board. The board draws ONE floor at a time (it never knows floors exist); this keeps the whole
// sketch, hands the board the current floor, and files what the board returns back onto that floor. A sketch with no floors
// is shown exactly as before, with an Add floor button above it. Everything the parent gives SketchCanvas passes through.
// `floorsSlot`: where to put the floors row when the page has a place for it beside its own tabs (null = not ready yet, left out until it is).
export default function FloorCanvas({ plan: initialPlan, onChange, floorsSlot, ...rest }) {
  const fullRef = useRef(normalizePlan(initialPlan));
  const [floorId, setFloorId] = useState(() => currentFloor(fullRef.current, null));
  const [rev, setRev] = useState(0); // the board reads its plan once when it opens, so a change made here reopens it
  const [stairsOpen, setStairsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [note, setNote] = useState('');
  const full = fullRef.current;
  const floors = full.floors || [];

  const apply = useCallback((next, nextFloor) => {
    fullRef.current = next;
    setFloorId(nextFloor === undefined ? currentFloor(next, floorId) : nextFloor);
    setRev((n) => n + 1);
    setNote('');
    onChange?.(next);
  }, [floorId, onChange]);

  const fromBoard = useCallback((view) => {
    const merged = fullRef.current.floors?.length ? mergeFloor(fullRef.current, currentFloor(fullRef.current, floorId), view) : view;
    fullRef.current = merged;
    onChange?.(merged);
  }, [floorId, onChange]);

  const add = (at) => {
    const r = addFloor(fullRef.current, '', at);
    if (!r.id) { setNote(`A sketch holds up to ${MAX_FLOORS} floors.`); return; }
    apply(r.plan, r.id);
  };
  const del = () => {
    if (!floorIsEmpty(fullRef.current, floorId)) { setNote('Clear everything off this floor first, then it can be removed.'); return; }
    const next = removeFloor(fullRef.current, floorId);
    apply(next, currentFloor(next, null));
  };
  const stairsTo = (toId) => {
    setStairsOpen(false);
    const view = floorView(fullRef.current, floorId);
    const b = planBounds(view);
    const x = b ? Math.round((b.minX + b.maxX) / 2) : 5;
    const y = b ? Math.round((b.minY + b.maxY) / 2) : 5;
    const next = addStairs(fullRef.current, floorId, toId, x, y, makeObject);
    if (next === fullRef.current) return;
    apply(next, floorId);
    setNote('Stairs placed in the middle of this floor and on the floor they lead to. Drag them into position on each floor.');
  };

  const view = floors.length ? floorView(full, currentFloor(full, floorId)) : full;
  const cur = floors.find((f) => f.id === currentFloor(full, floorId));
  const slots = floorSlots(full);
  const bar = (
    <div className={`floors-bar${floorsSlot ? ' in-slot' : ''}`}>
      {floors.length > 0 && (
        <div className="floors-tabs" role="tablist" aria-label="Floors">
          {floors.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={f.id === cur?.id} className={f.id === cur?.id ? 'on' : ''} onClick={() => { if (f.id !== cur?.id) apply(fullRef.current, f.id); }}>{f.name}</button>
          ))}
        </div>
      )}
      <select className="floors-add" aria-label="Add a floor" value="" disabled={floors.length >= MAX_FLOORS} onChange={(e) => { if (e.target.value !== '') add(Number(e.target.value)); }}>
        <option value="">{floors.length ? '+ Floor' : 'Add a floor'}</option>
        {slots.map((o) => <option key={o.at} value={o.at}>{o.label}</option>)}
      </select>
      {floors.length > 1 && (
        <>
          <button type="button" className="secondary small" onClick={() => setStairsOpen((o) => !o)} aria-expanded={stairsOpen}>Stairs</button>
          <button type="button" className="secondary small" onClick={() => setRenaming((o) => !o)}>Rename</button>
          <button type="button" className="secondary small" onClick={del}>Remove floor</button>
        </>
      )}
    </div>
  );
  return (
    <>
      {floorsSlot === undefined && bar}
      {floorsSlot && createPortal(bar, floorsSlot)}
      {stairsOpen && cur && (
        <div className="floors-pop" role="group" aria-label="Stairs to">
          <span className="muted">Stairs from {cur.name} to:</span>
          {floors.filter((f) => f.id !== cur.id).map((f) => <button key={f.id} type="button" className="secondary small" onClick={() => stairsTo(f.id)}>{f.name}</button>)}
        </div>
      )}
      {renaming && cur && (
        <div className="floors-pop">
          <label htmlFor="floor-name" className="muted">Name</label>
          <input id="floor-name" key={cur.id} defaultValue={cur.name} maxLength={30} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            onBlur={(e) => { setRenaming(false); const next = renameFloor(fullRef.current, cur.id, e.target.value); if (next !== fullRef.current) apply(next, cur.id); }} />
        </div>
      )}
      {note && <p className="hint" role="status">{note}</p>}
      <SketchCanvas key={`${cur?.id || 'one'}:${rev}`} plan={view} onChange={fromBoard} {...rest} />
    </>
  );
}
