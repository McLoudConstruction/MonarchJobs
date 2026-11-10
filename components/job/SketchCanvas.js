'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MARK_COLORS, MAX_MARKS, MAX_ROOMS, MIN_ROOM, MAX_ROOM, ROOM_PRESETS,
  fitView, hitHandle, hitMarkAt, hitRoom, makeId, newRoom, normalizePlan, parseFeet, planBounds,
  roomAreaText, simplifyStroke, snap, toWorld, totalArea, fmtFeet,
} from '@/lib/sketch';
import { drawPlan } from '@/lib/sketchDraw';

const TOOLS = [
  ['select', 'Select'],
  ['pan', 'Move view'],
  ['room', 'Draw room'],
  ['pen', 'Pen'],
  ['text', 'Text'],
];
const HINTS = {
  select: 'Tap a room or note to select it. Drag to move it. Drag the square corner to resize.',
  pan: 'Drag to move around. Pinch or use + and - to zoom.',
  room: 'Drag on the sketch to draw a room. You can type exact sizes afterwards.',
  pen: 'Draw freehand: doors, walls, arrows, anything. Tap a line with Select to remove it.',
  text: 'Tap where the note should go, then type it.',
};
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The drawing board. Works in feet. The parent owns saving: onChange gets the whole new plan after
// each finished change. The plan prop is read once (the parent remounts this with a new key to
// switch sketches).
export default function SketchCanvas({ plan: initialPlan, onChange, photoCounts = {}, onAddRoomPhoto, onViewRoomPhotos, exportName = 'sketch' }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const planRef = useRef(normalizePlan(initialPlan));
  const viewRef = useRef({ scale: 14, ox: 40, oy: 40 });
  const dragRef = useRef(null);      // gesture in progress: { mode, plan?, draft?, ... }
  const pointers = useRef(new Map());
  const undoRef = useRef([]);
  const sizeRef = useRef({ W: 300, H: 400 });
  const countsRef = useRef(photoCounts);
  const rafRef = useRef(0);

  const [tool, setTool] = useState('select');
  const [sel, setSel] = useState(null); // { kind: 'room' | 'mark', id }
  const [color, setColor] = useState(MARK_COLORS[0]);
  const [textDraft, setTextDraft] = useState(null); // { x, y, value }
  const [canUndo, setCanUndo] = useState(false);
  const [, bump] = useState(0);
  const [dimErr, setDimErr] = useState('');
  const selRef = useRef(null);
  selRef.current = sel;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = dragRef.current;
    drawPlan(ctx, d?.plan || planRef.current, viewRef.current, {
      W: sizeRef.current.W, H: sizeRef.current.H, selection: selRef.current, counts: countsRef.current,
      draft: d?.draft || null,
    });
  }, []);
  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw(); });
  }, [draw]);

  useEffect(() => { countsRef.current = photoCounts; schedule(); }, [photoCounts, schedule]);
  useEffect(() => { schedule(); setDimErr(''); }, [sel, schedule]);

  // size the canvas to its box, keep it crisp on high-density screens, and fit the drawing once
  const fittedRef = useRef(false);
  useEffect(() => {
    const wrap = wrapRef.current;
    const c = canvasRef.current;
    if (!wrap || !c) return undefined;
    const resize = () => {
      const W = Math.max(200, wrap.clientWidth);
      const H = Math.max(240, wrap.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
      sizeRef.current = { W, H };
      if (!fittedRef.current) {
        viewRef.current = fitView(planBounds(planRef.current), W, H);
        fittedRef.current = true;
      }
      draw();
    };
    resize();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    ro?.observe(wrap);
    window.addEventListener('resize', resize);
    return () => { ro?.disconnect(); window.removeEventListener('resize', resize); cancelAnimationFrame(rafRef.current); };
  }, [draw]);

  // ---- changes -----------------------------------------------------------
  const commit = useCallback((next) => {
    undoRef.current.push(planRef.current);
    if (undoRef.current.length > 60) undoRef.current.shift();
    planRef.current = next;
    setCanUndo(true);
    onChange?.(next);
    bump((n) => n + 1);
    schedule();
  }, [onChange, schedule]);

  function undo() {
    const prev = undoRef.current.pop();
    if (!prev) return;
    planRef.current = prev;
    setCanUndo(undoRef.current.length > 0);
    if (selRef.current && !findSel(prev, selRef.current)) setSel(null);
    onChange?.(prev);
    bump((n) => n + 1);
    schedule();
  }

  const findSel = (plan, s) => (!s ? null : s.kind === 'room' ? plan.rooms.find((r) => r.id === s.id) : plan.marks.find((m) => m.id === s.id)) || null;
  const selected = findSel(planRef.current, sel);

  function patchRoom(id, patch) {
    commit({ ...planRef.current, rooms: planRef.current.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }
  function patchMark(id, patch) {
    commit({ ...planRef.current, marks: planRef.current.marks.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  }
  function removeSelected() {
    if (!sel) return;
    const p = planRef.current;
    commit(sel.kind === 'room' ? { ...p, rooms: p.rooms.filter((r) => r.id !== sel.id) } : { ...p, marks: p.marks.filter((m) => m.id !== sel.id) });
    setSel(null);
  }

  function addRoom() {
    const p = planRef.current;
    if (p.rooms.length >= MAX_ROOMS) return;
    const { W, H } = sizeRef.current;
    const c = toWorld(viewRef.current, W / 2, H / 2);
    // nudge so a new room never lands exactly on top of another
    let n = 0;
    let room = newRoom('', c.x - 5, c.y - 5);
    while (p.rooms.some((r) => r.x === room.x && r.y === room.y) && n < 20) { n += 1; room = newRoom('', c.x - 5 + n, c.y - 5 + n); }
    commit({ ...p, rooms: [...p.rooms, room] });
    setSel({ kind: 'room', id: room.id });
    setTool('select');
  }

  function duplicateRoom() {
    const r = selected;
    if (!r || sel.kind !== 'room' || planRef.current.rooms.length >= MAX_ROOMS) return;
    const copy = { ...r, id: makeId(), x: snap(r.x + r.w + 1), label: r.label ? `${r.label} 2` : '' };
    commit({ ...planRef.current, rooms: [...planRef.current.rooms, copy] });
    setSel({ kind: 'room', id: copy.id });
  }

  // ---- view --------------------------------------------------------------
  function zoomAt(factor, sx, sy) {
    const v = viewRef.current;
    const scale = clampN(v.scale * factor, 3, 120);
    const w = toWorld(v, sx, sy);
    viewRef.current = { scale, ox: sx - w.x * scale, oy: sy - w.y * scale };
    schedule();
  }
  const zoomCenter = (f) => zoomAt(f, sizeRef.current.W / 2, sizeRef.current.H / 2);
  function fit() {
    viewRef.current = fitView(planBounds(planRef.current), sizeRef.current.W, sizeRef.current.H);
    schedule();
  }

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
    // zoomAt only uses refs, so the first copy is always current
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- pointer gestures --------------------------------------------------
  const local = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function onDown(e) {
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.closest('.sketch')?.focus({ preventScroll: true }); // so Delete and Ctrl+Z work
    canvasRef.current.setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size === 2) { // second finger: pinch and pan, drop whatever was being drawn
      const [a, b] = [...pointers.current.values()];
      dragRef.current = {
        mode: 'pinch', view: { ...viewRef.current },
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      };
      schedule();
      return;
    }
    if (pointers.current.size > 2) return;

    const v = viewRef.current;
    const w = toWorld(v, p.x, p.y);
    const plan = planRef.current;
    const tolFt = 12 / v.scale; // 12 screen pixels, in feet
    const t = toolRef.current;

    if (t === 'pan') { dragRef.current = { mode: 'pan', sx: p.x, sy: p.y, ox: v.ox, oy: v.oy }; return; }

    if (t === 'room') {
      const x = snap(w.x); const y = snap(w.y);
      dragRef.current = { mode: 'room', x0: x, y0: y, draft: { type: 'room', x, y, w: 0, h: 0 } };
      return;
    }
    if (t === 'pen') {
      dragRef.current = { mode: 'pen', pts: [[w.x, w.y]], draft: { type: 'pen', color: colorRef.current, pts: [[w.x, w.y]] } };
      schedule();
      return;
    }
    if (t === 'text') { dragRef.current = { mode: 'text', sx: p.x, sy: p.y, wx: w.x, wy: w.y }; return; }

    // select tool
    const s = selRef.current;
    const cur = findSel(plan, s);
    if (cur && s.kind === 'room' && hitHandle(cur, w.x, w.y, tolFt)) {
      dragRef.current = { mode: 'resize', id: cur.id, plan };
      return;
    }
    const mark = hitMarkAt(plan, w.x, w.y, tolFt * 0.6);
    const room = hitRoom(plan, w.x, w.y);
    // a pen stroke or note lying on a room wins over the room under it
    if (mark) {
      setSel({ kind: 'mark', id: mark.id });
      dragRef.current = { mode: 'move-mark', id: mark.id, wx: w.x, wy: w.y, orig: mark, plan, moved: false };
    } else if (room) {
      setSel({ kind: 'room', id: room.id });
      dragRef.current = { mode: 'move-room', id: room.id, dx: w.x - room.x, dy: w.y - room.y, plan, moved: false };
    } else {
      setSel(null);
      dragRef.current = { mode: 'pan', sx: p.x, sy: p.y, ox: v.ox, oy: v.oy };
    }
    schedule();
  }

  function onMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const d = dragRef.current;
    if (!d) return;
    const v = viewRef.current;

    if (d.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2; const cy = (a.y + b.y) / 2;
      const scale = clampN(d.view.scale * (dist / d.dist), 3, 120);
      const w0 = toWorld(d.view, d.cx, d.cy);
      viewRef.current = { scale, ox: cx - w0.x * scale, oy: cy - w0.y * scale };
      schedule();
      return;
    }
    if (pointers.current.size > 1) return;

    const w = toWorld(v, p.x, p.y);
    if (d.mode === 'pan') {
      viewRef.current = { ...v, ox: d.ox + (p.x - d.sx), oy: d.oy + (p.y - d.sy) };
    } else if (d.mode === 'room') {
      const x1 = snap(w.x); const y1 = snap(w.y);
      d.draft = { type: 'room', x: Math.min(d.x0, x1), y: Math.min(d.y0, y1), w: Math.abs(x1 - d.x0), h: Math.abs(y1 - d.y0) };
    } else if (d.mode === 'pen') {
      d.pts.push([w.x, w.y]);
      d.draft = { type: 'pen', color: colorRef.current, pts: d.pts };
    } else if (d.mode === 'move-room') {
      d.moved = true;
      const x = snap(w.x - d.dx); const y = snap(w.y - d.dy);
      d.plan = { ...d.plan, rooms: d.plan.rooms.map((r) => (r.id === d.id ? { ...r, x, y } : r)) };
    } else if (d.mode === 'resize') {
      d.moved = true;
      d.plan = {
        ...d.plan,
        rooms: d.plan.rooms.map((r) => (r.id === d.id
          ? { ...r, w: clampN(snap(w.x - r.x), MIN_ROOM, MAX_ROOM), h: clampN(snap(w.y - r.y), MIN_ROOM, MAX_ROOM) }
          : r)),
      };
    } else if (d.mode === 'move-mark') {
      d.moved = true;
      const dx = w.x - d.wx; const dy = w.y - d.wy;
      const o = d.orig;
      const moved = o.type === 'pen'
        ? { ...o, pts: o.pts.map((q) => [q[0] + dx, q[1] + dy]) }
        : { ...o, x: o.x + dx, y: o.y + dy };
      d.plan = { ...planRef.current, marks: planRef.current.marks.map((m) => (m.id === d.id ? moved : m)) };
    }
    schedule();
  }

  function onUp(e) {
    const had = pointers.current.has(e.pointerId);
    const p = had ? local(e) : null;
    pointers.current.delete(e.pointerId);
    const d = dragRef.current;
    if (!d || !had) return;

    if (d.mode === 'pinch') {
      if (pointers.current.size < 2) dragRef.current = null; // stay still until all fingers are up
      if (pointers.current.size === 1) {
        // the finger left behind should not start a pan or draw
        const [id] = [...pointers.current.keys()];
        pointers.current.delete(id);
      }
      schedule();
      return;
    }
    dragRef.current = null;
    const plan = planRef.current;

    if (d.mode === 'room') {
      const dr = d.draft;
      if (dr && dr.w >= MIN_ROOM && dr.h >= MIN_ROOM && plan.rooms.length < MAX_ROOMS) {
        const room = newRoom('', dr.x, dr.y, dr.w, dr.h);
        commit({ ...plan, rooms: [...plan.rooms, room] });
        setSel({ kind: 'room', id: room.id });
        setTool('select');
      }
    } else if (d.mode === 'pen') {
      const v = viewRef.current;
      const pts = simplifyStroke(d.pts, 2 / v.scale).map((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]);
      if (plan.marks.length < MAX_MARKS && pts.length) {
        const mark = { id: makeId(), type: 'pen', color: colorRef.current, pts };
        commit({ ...plan, marks: [...plan.marks, mark] });
      }
    } else if (d.mode === 'text') {
      if (p && Math.hypot(p.x - d.sx, p.y - d.sy) < 8) setTextDraft({ x: snap(d.wx, 0.25), y: snap(d.wy, 0.25), value: '' });
    } else if ((d.mode === 'move-room' || d.mode === 'resize' || d.mode === 'move-mark') && d.moved && d.plan) {
      const next = normalizePlan(d.plan);
      // normalizePlan re-ids on duplicates only; ids here are unique, so selection stays valid
      commit(next);
    }
    schedule();
  }

  function onCancel(e) {
    pointers.current.delete(e.pointerId);
    dragRef.current = null;
    schedule();
  }

  function addText(e) {
    e?.preventDefault();
    const t = textDraft;
    if (!t || !t.value.trim() || planRef.current.marks.length >= MAX_MARKS) { setTextDraft(null); return; }
    const mark = { id: makeId(), type: 'text', color, x: t.x, y: t.y, text: t.value.trim().slice(0, 60) };
    commit({ ...planRef.current, marks: [...planRef.current.marks, mark] });
    setTextDraft(null);
  }

  // keyboard: Delete removes the selection, Ctrl/Cmd+Z undoes
  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSelected(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  }

  // ---- dimension entry ---------------------------------------------------
  function setDim(which, text) {
    if (!selected || sel.kind !== 'room') return;
    const ft = parseFeet(text);
    if (!Number.isFinite(ft) || ft < MIN_ROOM || ft > MAX_ROOM) { setDimErr(`Enter a size between ${MIN_ROOM} and ${MAX_ROOM} feet, like 12 or 12'6".`); return; }
    setDimErr('');
    patchRoom(selected.id, { [which]: ft });
  }

  // ---- export ------------------------------------------------------------
  function exportPng() {
    const plan = planRef.current;
    const b = planBounds(plan);
    if (!b) return;
    const W = 1600;
    const H = Math.round(clampN(1600 * ((b.maxY - b.minY + 4) / Math.max(b.maxX - b.minX + 4, 4)), 500, 2400));
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    const view = fitView(b, W, H, 60);
    drawPlan(ctx, plan, view, { W, H, counts: {}, grid: true });
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exportName.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'sketch'}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  }

  const plan = planRef.current;
  const total = totalArea(plan);
  const room = selected && sel.kind === 'room' ? selected : null;
  const mark = selected && sel.kind === 'mark' ? selected : null;
  const roomPhotos = room ? photoCounts[room.id] || 0 : 0;

  return (
    <div className="sketch" onKeyDown={onKey} tabIndex={-1}>
      <div className="sketch-bar">
        <div className="sketch-tools" role="toolbar" aria-label="Sketch tools">
          {TOOLS.map(([k, label]) => (
            <button key={k} type="button" className={tool === k ? 'on' : ''} aria-pressed={tool === k} onClick={() => { setTool(k); setTextDraft(null); }}>{label}</button>
          ))}
          <button type="button" onClick={addRoom} disabled={plan.rooms.length >= MAX_ROOMS}>+ Room</button>
        </div>
        <div className="sketch-tools">
          <button type="button" onClick={undo} disabled={!canUndo}>Undo</button>
          <button type="button" onClick={() => zoomCenter(1 / 1.3)} aria-label="Zoom out">-</button>
          <button type="button" onClick={() => zoomCenter(1.3)} aria-label="Zoom in">+</button>
          <button type="button" onClick={fit}>Fit</button>
          <button type="button" onClick={exportPng} disabled={!plan.rooms.length && !plan.marks.length}>Save PNG</button>
        </div>
      </div>

      <div className="sketch-stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className={`sketch-canvas tool-${tool}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          aria-label="Sketch drawing area"
        />
      </div>

      <div className="sketch-summary">
        {plan.rooms.length} room{plan.rooms.length === 1 ? '' : 's'}{plan.rooms.length > 0 && <> · {total.toLocaleString()} sq ft total</>}
        <span className="muted"> · {HINTS[tool]}</span>
      </div>

      {textDraft && (
        <form className="sketch-panel" onSubmit={addText}>
          <div className="field" style={{ margin: 0, flex: 1 }}>
            <label htmlFor="sk-text">Note text</label>
            <input id="sk-text" autoFocus maxLength={60} value={textDraft.value} onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })} placeholder="Door, wet wall, sump..." />
          </div>
          <button className="primary small">Add</button>
          <button type="button" className="secondary small" onClick={() => setTextDraft(null)}>Cancel</button>
        </form>
      )}

      {tool === 'pen' || tool === 'text' ? (
        <div className="sketch-panel">
          <span className="muted">Color</span>
          <div className="sketch-colors">
            {MARK_COLORS.map((c) => (
              <button key={c} type="button" className={color === c ? 'on' : ''} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
      ) : null}

      {room && (
        <div className="sketch-panel col">
          <div className="grid2">
            <div className="field"><label htmlFor="sk-room-name">Room name</label>
              <input id="sk-room-name" key={`${room.id}-l-${room.label}`} defaultValue={room.label} maxLength={40} onBlur={(e) => e.target.value !== room.label && patchRoom(room.id, { label: e.target.value })} placeholder="Kitchen" />
            </div>
            <div className="field"><label htmlFor="sk-room-notes">Notes</label>
              <input id="sk-room-notes" key={`${room.id}-n-${room.notes}`} defaultValue={room.notes} maxLength={300} onBlur={(e) => e.target.value !== room.notes && patchRoom(room.id, { notes: e.target.value })} placeholder="Hardwood, wet along north wall" />
            </div>
          </div>
          <div className="sketch-presets">
            {ROOM_PRESETS.map((p) => <button key={p} type="button" onClick={() => patchRoom(room.id, { label: p })}>{p}</button>)}
          </div>
          <div className="grid2">
            <div className="field"><label htmlFor="sk-room-w">Width (feet)</label>
              <input id="sk-room-w" key={`${room.id}-w-${room.w}`} inputMode="decimal" defaultValue={fmtFeet(room.w)} onBlur={(e) => setDim('w', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
            </div>
            <div className="field"><label htmlFor="sk-room-h">Length (feet)</label>
              <input id="sk-room-h" key={`${room.id}-h-${room.h}`} inputMode="decimal" defaultValue={fmtFeet(room.h)} onBlur={(e) => setDim('h', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
            </div>
          </div>
          {dimErr && <div className="msg err" style={{ margin: 0 }}>{dimErr}</div>}
          <div className="muted">{roomAreaText(room)}</div>
          <div className="row">
            {onAddRoomPhoto && <button type="button" className="secondary small" onClick={() => onAddRoomPhoto(room)}>Add photo to this room</button>}
            {onViewRoomPhotos && roomPhotos > 0 && <button type="button" className="secondary small" onClick={() => onViewRoomPhotos(room)}>View photos ({roomPhotos})</button>}
            <button type="button" className="secondary small" onClick={() => patchRoom(room.id, { w: room.h, h: room.w })}>Swap width and length</button>
            <button type="button" className="secondary small" onClick={duplicateRoom}>Duplicate</button>
            <button type="button" className="danger small" onClick={removeSelected}>Delete room</button>
          </div>
        </div>
      )}

      {mark && (
        <div className="sketch-panel">
          {mark.type === 'text' && (
            <div className="field" style={{ margin: 0, flex: 1 }}>
              <label htmlFor="sk-mark-text">Note text</label>
              <input id="sk-mark-text" key={mark.id} defaultValue={mark.text} maxLength={60} onBlur={(e) => e.target.value.trim() && e.target.value !== mark.text && patchMark(mark.id, { text: e.target.value.trim() })} />
            </div>
          )}
          <div className="sketch-colors">
            {MARK_COLORS.map((c) => (
              <button key={c} type="button" className={mark.color === c ? 'on' : ''} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => patchMark(mark.id, { color: c })} />
            ))}
          </div>
          <button type="button" className="danger small" onClick={removeSelected}>Delete</button>
        </div>
      )}
    </div>
  );
}
