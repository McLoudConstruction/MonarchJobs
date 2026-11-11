'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AREA_KINDS, MARK_COLORS, MAX_MARKS, MAX_ROOMS, MAX_AREAS, MAX_SOURCES, MIN_ROOM, MAX_ROOM, ROOM_PRESETS, SURFACES, WALL_HEIGHTS, WATER_CATS,
  addCornerCut, affectedTotals, carveRooms, cleanSurfaces, cleanWater, dropStraightPoints, edgeLength, fitView, hitMarkAt, hitRoom, hitSource,
  insertBreak, isRect, makeId, moveEdgeSnapped, moveVertex, nearestAnchor, nearestEdge, nearestVertex, newArea, newRoom, newSource, normalizePlan, placeGrowth,
  parseFeet, pickArea, planBounds, rectPts, removeVertex, resizeRect, roomAreaText, roomBox, roomSizeText, setEdgeLength,
  simplifyStroke, snap, snapOnEdge, surfaceText, tidyPts, toScreen, toWorld, totalArea, translatePts, fmtFeet,
} from '@/lib/sketch';
import { drawPlan, areaStyle, WATER_LINE } from '@/lib/sketchDraw';
import { OBJECT_TYPES, OBJECT_GROUPS, MAX_OBJECTS, makeObject, objectCounts } from '@/lib/objectTypes';
import { placeObject, hitObject } from '@/lib/sketchObjects';
import { jpegToPdf } from '@/lib/pdfImage';

const TOOLS = [
  ['select', 'Select', 'V'],
  ['pan', 'Pan', 'Space'],
  ['room', 'Draw room', 'R'],
  ['break', 'Wall break', 'B'],
  ['corner', 'Add corner', 'C'],
  ['area', 'Affected areas', 'W'],
  ['object', 'Objects', 'O'],
  ['pen', 'Pen', 'P'],
  ['text', 'Text', 'T'],
];
const KEYS = { v: 'select', r: 'room', b: 'break', c: 'corner', w: 'area', o: 'object', p: 'pen', t: 'text' };
const HINTS = {
  select: 'Click a room to select it, then drag its corners or walls. Hold Alt (or turn on Angles) to move a corner in any direction. Hold Ctrl and drag a corner or wall to start a new room there. Double-click a corner, or press Delete with it selected, to remove it.',
  pan: 'Drag to move around. Pinch or scroll to zoom. From any tool, hold Space and drag to pan, then let go to carry on.',
  room: 'Drag on the sketch to draw a room. It snaps to the corners and walls of rooms already there.',
  break: 'Hover a wall and click to cut it in two. Switch to Select (V), then drag either side of the cut in or out.',
  corner: 'Hover a wall and click to add a corner. To cut off a corner of a room, click one wall, then click the wall next to it. The tool stays on, so keep clicking. Esc starts over.',
  area: 'Pick what to mark and which surfaces it is on, then draw around it. It is cleaned up when you let go.',
  object: 'Pick an object, then click to place it. Doors, windows and outlets snap to the wall; cabinets and fixtures sit flush against it. Hold Alt to place freely. Esc stops. Click one with Select to edit it.',
  pen: 'Draw freehand: doors, arrows, anything. Tap a line with Select to remove it.',
  text: 'Tap where the note should go, then type it.',
};
const AREA_HINTS = {
  water: 'Draw around where the water went. Choose the surfaces it reached.',
  growth: 'Draw a line along a wall, or a loop for the ceiling. It snaps to the nearest one. Choose Manual or hold Alt to place it freely.',
  smoke: 'Draw around what the smoke reached. Choose the surfaces it is on.',
  source: 'Tap where the loss started.',
};
const SURFACE_VIEWS = [['all', 'All surfaces'], ['floor', 'Floor'], ['wall', 'Walls'], ['ceiling', 'Ceiling']];
const KIND_ORDER = ['water', 'source', 'growth', 'smoke'];
const kindDot = (kind) => areaStyle({ kind, cat: 2 }).line;
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const inField = (el) => {
  const tag = (el?.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable;
};

function SurfaceChips({ value, onChange }) {
  return (
    <div className="chips" role="group" aria-label="Surfaces">
      {Object.entries(SURFACES).map(([k, label]) => (
        <button key={k} type="button" className={value.includes(k) ? 'on' : ''} aria-pressed={value.includes(k)}
          onClick={() => { const next = value.includes(k) ? value.filter((x) => x !== k) : [...value, k]; if (next.length) onChange(cleanSurfaces(next)); }}>{label}</button>
      ))}
    </div>
  );
}
function CatChips({ value, onChange }) {
  return (
    <div className="chips" role="group" aria-label="Water category">
      {[1, 2, 3].map((n) => (
        <button key={n} type="button" className={value === n ? 'on' : ''} aria-pressed={value === n} title={WATER_CATS[n]} onClick={() => onChange(n)}>
          <span className="sk-dot" style={{ background: WATER_LINE[n] }} />Cat {n}
        </button>
      ))}
    </div>
  );
}
function HeightChips({ value, onChange }) {
  return (
    <div className="chips" role="group" aria-label="How high up the wall">
      {WALL_HEIGHTS.map((h) => (
        <button key={h} type="button" className={value === h ? 'on' : ''} aria-pressed={value === h} onClick={() => onChange(h)}>{h === 8 ? 'Full' : `${h}'`}</button>
      ))}
    </div>
  );
}
const FullIcon = ({ on }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {on ? <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" /> : <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />}
  </svg>
);

const Ico = ({ children }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const UploadIcon = () => <Ico><path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v3h11v-3" /></Ico>;
const UndoIcon = () => <Ico><path d="M5.5 3L2.5 6l3 3M2.8 6H9a4 4 0 0 1 0 8H6" /></Ico>;
const RedoIcon = () => <Ico><path d="M10.5 3l3 3-3 3M13.2 6H7a4 4 0 0 0 0 8h3" /></Ico>;
const PlusIcon = () => <Ico><path d="M8 3v10M3 8h10" /></Ico>;
const MinusIcon = () => <Ico><path d="M3 8h10" /></Ico>;
const FitIcon = () => <Ico><rect x="3.5" y="3.5" width="9" height="9" rx="1" /><path d="M1.5 5V1.5H5M11 1.5h3.5V5M14.5 11v3.5H11M5 14.5H1.5V11" /></Ico>;

// The drawing board. Works in feet. The parent owns saving: onChange gets the whole new plan after
// each finished change. The plan prop is read once (the parent remounts this with a new key to
// switch sketches).
export default function SketchCanvas({ plan: initialPlan, onChange, photoCounts = {}, onAddRoomPhoto, onViewRoomPhotos, exportName = 'sketch', headSlot = null }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const rootRef = useRef(null);
  const planRef = useRef(normalizePlan(initialPlan));
  const totalsRef = useRef({ plan: null, totals: { rooms: {}, total: {} } });
  const popRef = useRef(null);
  const viewRef = useRef({ scale: 14, ox: 40, oy: 40 });
  const dragRef = useRef(null);      // gesture in progress: { mode, plan?, draft?, ... }
  const hoverRef = useRef(null);
  const spaceRef = useRef(null); // while Space is held: { back } the tool to return to
  const lastCornerRef = useRef(null); // Add corner: the point the last click added, { roomId, x, y }
  const pointers = useRef(new Map());
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const sizeRef = useRef({ W: 300, H: 400 });
  const countsRef = useRef(photoCounts);
  const rafRef = useRef(0);

  const [tool, setTool] = useState('select');
  const [sel, setSel] = useState(null); // { kind: 'room' | 'mark' | 'area' | 'source', id, vi?, ei? }
  const [color, setColor] = useState(MARK_COLORS[0]);
  const [areaKind, setAreaKind] = useState('water'); // what the Affected areas tool is marking
  const [waterCat, setWaterCat] = useState(1);
  const [growthAuto, setGrowthAuto] = useState(true); // Growth: lines snap to a wall, loops to a ceiling
  const [areaMode, setAreaMode] = useState('smooth');
  const [surfaces, setSurfaces] = useState(['floor']); // surfaces for the next thing drawn
  const [wallHeight, setWallHeight] = useState(2);
  const [surfaceView, setSurfaceView] = useState('all'); // which surface to show: all, floor, wall, ceiling
  const [menuOpen, setMenuOpen] = useState(false);
  const [objMenu, setObjMenu] = useState(false);
  const [objType, setObjType] = useState('door'); // what the Objects tool places
  const ghostRef = useRef(null); // Objects tool: the preview under the pointer
  const objTypeRef = useRef('door');
  objTypeRef.current = objType;
  const [popup, setPopup] = useState(null); // { x, y }: where the editor for the selected item floats
  const [full, setFull] = useState(false);
  const [freeAngle, setFreeAngle] = useState(false);
  const [textDraft, setTextDraft] = useState(null); // { x, y, value }
  const [exportOpen, setExportOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [, bump] = useState(0);
  const [dimErr, setDimErr] = useState('');
  const selRef = useRef(null);
  selRef.current = sel;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const areaRef = useRef({});
  areaRef.current = { kind: areaKind, cat: waterCat, mode: areaMode, surfaces, height: wallHeight, auto: growthAuto };
  const surfaceRef = useRef('all');
  surfaceRef.current = surfaceView;
  const popupRef = useRef(null);
  popupRef.current = popup;
  const fullRef = useRef(false);
  fullRef.current = full;
  const freeRef = useRef(false);
  freeRef.current = freeAngle;

  // what is affected in each room; worked out when the plan changes, not while dragging
  const totalsFor = (plan) => {
    if (totalsRef.current.plan !== plan) totalsRef.current = { plan, totals: affectedTotals(plan) };
    return totalsRef.current.totals;
  };

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = dragRef.current;
    const committed = planRef.current;
    if (totalsRef.current.plan !== committed) totalsRef.current = { plan: committed, totals: affectedTotals(committed) };
    drawPlan(ctx, d?.plan || committed, viewRef.current, {
      W: sizeRef.current.W, H: sizeRef.current.H, selection: selRef.current, counts: countsRef.current, surface: surfaceRef.current,
      affected: totalsRef.current.totals.rooms, draft: d?.draft || null, hover: d ? null : hoverRef.current,
      pending: toolRef.current === 'corner' ? lastCornerRef.current : null,
      ghost: toolRef.current === 'object' && !d ? ghostRef.current : null,
    });
  }, []);
  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw(); });
  }, [draw]);

  useEffect(() => { countsRef.current = photoCounts; schedule(); }, [photoCounts, schedule]);
  useEffect(() => { schedule(); setDimErr(''); }, [sel, schedule]);
  useEffect(() => { schedule(); }, [surfaceView, schedule]);
  useEffect(() => { hoverRef.current = null; lastCornerRef.current = null; setPopup(null); setMenuOpen(false); setObjMenu(false); ghostRef.current = null; schedule(); }, [tool, schedule]);

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
        viewRef.current = fitView(planBounds(planRef.current), W, H, 24, controlInset());
        fittedRef.current = true;
      }
      draw();
    };
    resize();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    ro?.observe(wrap);
    window.addEventListener('resize', resize);
    return () => { ro?.disconnect(); window.removeEventListener('resize', resize); cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  }, [draw]);

  // ---- changes -----------------------------------------------------------
  const commit = useCallback((next) => {
    undoRef.current.push(planRef.current);
    if (undoRef.current.length > 80) undoRef.current.shift();
    redoRef.current = [];
    planRef.current = next;
    setCanUndo(true);
    setCanRedo(false);
    onChange?.(next);
    bump((n) => n + 1);
    schedule();
  }, [onChange, schedule]);

  const findSel = (plan, s) => {
    if (!s) return null;
    const list = s.kind === 'room' ? plan.rooms : s.kind === 'area' ? plan.areas : s.kind === 'source' ? plan.sources : s.kind === 'object' ? plan.objects : plan.marks;
    return list.find((x) => x.id === s.id) || null;
  };

  function undo() {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(planRef.current);
    lastCornerRef.current = null;
    planRef.current = prev;
    setCanUndo(undoRef.current.length > 0);
    setCanRedo(true);
    if (selRef.current && !findSel(prev, selRef.current)) setSel(null);
    onChange?.(prev);
    bump((n) => n + 1);
    schedule();
  }
  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(planRef.current);
    lastCornerRef.current = null;
    planRef.current = next;
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
    if (selRef.current && !findSel(next, selRef.current)) setSel(null);
    onChange?.(next);
    bump((n) => n + 1);
    schedule();
  }

  const selected = findSel(planRef.current, sel);

  function patchRoom(id, patch) {
    commit({ ...planRef.current, rooms: planRef.current.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }
  function patchMark(id, patch) {
    commit({ ...planRef.current, marks: planRef.current.marks.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  }
  function patchArea(id, patch) {
    commit({ ...planRef.current, areas: planRef.current.areas.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  }
  function patchSource(id, patch) {
    commit({ ...planRef.current, sources: planRef.current.sources.map((q) => (q.id === id ? { ...q, ...patch } : q)) });
  }
  function patchObject(id, patch) {
    commit({ ...planRef.current, objects: planRef.current.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  }
  function duplicateObject(o) {
    const p = planRef.current;
    if (p.objects.length >= MAX_OBJECTS) return;
    const copy = makeObject(o.t, o.x + 1, o.y + 1, { r: o.r, w: o.w, d: o.d, label: o.label, note: o.note, h: o.h, f: o.f, m: o.m });
    commit({ ...p, objects: [...p.objects, copy] });
    setSel({ kind: 'object', id: copy.id });
  }
  // the editor floats near the item that was clicked; closing it first saves a field that is still being typed in
  function openPopup(x, y) { setPopup({ x, y }); }
  function closePopup() {
    const ae = document.activeElement;
    if (ae && popRef.current && popRef.current.contains(ae)) ae.blur();
    setPopup(null);
  }
  function removeSelected() {
    const s = selRef.current;
    if (!s) return;
    const p = planRef.current;
    if (s.kind === 'room' && s.vi != null && s.vi >= 0) { // a corner is selected: remove just that corner
      const r = p.rooms.find((x) => x.id === s.id);
      if (r && r.pts.length > 3) { patchRoom(r.id, { pts: removeVertex(r, s.vi).pts }); setSel({ kind: 'room', id: r.id }); return; }
    }
    if (s.kind === 'room') commit({ ...p, rooms: p.rooms.filter((r) => r.id !== s.id) });
    else if (s.kind === 'area') commit({ ...p, areas: p.areas.filter((a) => a.id !== s.id) });
    else if (s.kind === 'source') commit({ ...p, sources: p.sources.filter((q) => q.id !== s.id) });
    else if (s.kind === 'object') commit({ ...p, objects: p.objects.filter((o) => o.id !== s.id) });
    else commit({ ...p, marks: p.marks.filter((m) => m.id !== s.id) });
    setSel(null);
    setPopup(null);
  }

  function addRoom() {
    const p = planRef.current;
    if (p.rooms.length >= MAX_ROOMS) return;
    const { W, H } = sizeRef.current;
    const c = toWorld(viewRef.current, W / 2, H / 2);
    // nudge so a new room never lands exactly on top of another
    const same = (rm) => { const b = roomBox(rm); return b.x === snap(c.x - 5 + n) && b.y === snap(c.y - 5 + n); };
    let n = 0;
    while (p.rooms.some(same) && n < 20) n += 1;
    const room = newRoom('', c.x - 5 + n, c.y - 5 + n);
    commit({ ...p, rooms: [...p.rooms, room] });
    setSel({ kind: 'room', id: room.id });
    setTool('select');
    setPopup({ x: W / 2, y: H / 2 });
  }

  function duplicateRoom() {
    const r = selected;
    if (!r || sel.kind !== 'room' || planRef.current.rooms.length >= MAX_ROOMS) return;
    const b = roomBox(r);
    const copy = { ...r, id: makeId(), pts: translatePts(r.pts, snap(b.w + 1), 0), label: r.label ? `${r.label} 2` : '' };
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
  // How far the floating toolbars reach into the drawing, so Fit uses only the space left over.
  function controlInset() {
    const stage = wrapRef.current;
    if (!stage) return {};
    const r = stage.getBoundingClientRect();
    const tl = stage.querySelector('.sketch-over-tl')?.getBoundingClientRect();
    const tr = stage.querySelector('.sketch-over-tr')?.getBoundingClientRect();
    return {
      top: tl ? Math.max(0, tl.bottom - r.top) : 0,
      right: tr ? Math.max(0, r.right - tr.left) : 0,
    };
  }
  function fit() {
    viewRef.current = fitView(planBounds(planRef.current), sizeRef.current.W, sizeRef.current.H, 24, controlInset());
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

  // a corner snaps to another room's corner when it is close, otherwise to the grid
  function snapCorner(plan, x, y, tolFt, skip) {
    let best = null;
    let bestD = tolFt;
    for (const r of plan.rooms) {
      r.pts.forEach((p, i) => {
        if (skip && r.id === skip.id && i === skip.i) return;
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d <= bestD) { best = p; bestD = d; }
      });
    }
    return best ? { x: best[0], y: best[1] } : { x: snap(x), y: snap(y) };
  }

  function onDown(e) {
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    rootRef.current?.focus({ preventScroll: true }); // so the shortcut keys work
    canvasRef.current.setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (popupRef.current) closePopup();
    setMenuOpen(false); setObjMenu(false);

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
    const edgeTol = 9 / v.scale;
    const t = toolRef.current;
    const ctrl = e.ctrlKey || e.metaKey;

    if (t === 'pan') { dragRef.current = { mode: 'pan', sx: p.x, sy: p.y, ox: v.ox, oy: v.oy }; return; }

    // a new room: starts on a nearby corner or wall of an existing room when there is one
    if (t === 'room' || (t === 'select' && ctrl)) {
      const a = nearestAnchor(plan, w.x, w.y, tolFt);
      const x = a ? a.x : snap(w.x); const y = a ? a.y : snap(w.y);
      dragRef.current = { mode: 'room', x0: x, y0: y, draft: { type: 'room', x, y, w: 0, h: 0 } };
      schedule();
      return;
    }
    if (t === 'break' || t === 'corner') {
      let hit = null;
      for (let i = plan.rooms.length - 1; i >= 0 && !hit; i -= 1) {
        const ed = nearestEdge(plan.rooms[i], w.x, w.y, edgeTol * 1.3);
        if (ed) hit = { room: plan.rooms[i], ed };
      }
      if (hit && t === 'break') {
        const next = insertBreak(hit.room, hit.ed.i, hit.ed.x, hit.ed.y);
        if (next !== hit.room) {
          commit({ ...plan, rooms: plan.rooms.map((r) => (r.id === hit.room.id ? next : r)) });
          setSel({ kind: 'room', id: hit.room.id, ei: hit.ed.i });
        }
      } else if (hit) {
        // Add corner: the first click adds a corner and waits; a click on the next wall cuts the corner between them
        const last = lastCornerRef.current;
        const res = addCornerCut(hit.room, hit.ed.i, hit.ed.x, hit.ed.y, last && last.roomId === hit.room.id ? [last.x, last.y] : null);
        if (res.point) {
          commit({ ...plan, rooms: plan.rooms.map((r) => (r.id === hit.room.id ? res.room : r)) });
          setSel({ kind: 'room', id: hit.room.id });
          lastCornerRef.current = res.cut ? null : { roomId: hit.room.id, x: res.point[0], y: res.point[1] };
        }
      } else {
        lastCornerRef.current = null; // a click on empty space starts over
      }
      hoverRef.current = null;
      schedule();
      dragRef.current = null;
      return;
    }
    if (t === 'pen') {
      dragRef.current = { mode: 'pen', pts: [[w.x, w.y]], draft: { type: 'pen', color: colorRef.current, pts: [[w.x, w.y]] } };
      schedule();
      return;
    }
    if (t === 'area') {
      const a = areaRef.current;
      if (a.kind === 'source') { // a source of loss is a pin: one tap
        if (plan.sources.length < MAX_SOURCES) {
          const pin = newSource(snap(w.x, 0.25), snap(w.y, 0.25), a.surfaces);
          commit({ ...plan, sources: [...plan.sources, pin] });
          setSel({ kind: 'source', id: pin.id });
        }
        dragRef.current = null;
        return;
      }
      dragRef.current = { mode: 'area', free: e.altKey, pts: [[w.x, w.y]], draft: { type: 'area', kind: a.kind, cat: a.cat, pts: [[w.x, w.y]] } };
      schedule();
      return;
    }
    if (t === 'object') { // click to place; the tool stays on so several can go in a row
      if (plan.objects.length < MAX_OBJECTS) {
        const type = objTypeRef.current;
        const pos = placeObject(plan, type, w.x, w.y, { free: e.altKey });
        const obj = makeObject(type, pos.x, pos.y, { r: pos.r });
        commit({ ...plan, objects: [...plan.objects, obj] });
        setSel({ kind: 'object', id: obj.id });
      }
      dragRef.current = null;
      return;
    }
    if (t === 'text') { dragRef.current = { mode: 'text', sx: p.x, sy: p.y, wx: w.x, wy: w.y }; return; }

    // select tool. The selected shape's own corners and walls come first.
    const s = selRef.current;
    const cur = findSel(plan, s);
    if (cur && s.kind === 'room') {
      const vi = nearestVertex(cur, w.x, w.y, tolFt);
      if (vi >= 0) {
        setSel({ kind: 'room', id: cur.id, vi });
        dragRef.current = { mode: 'vertex', id: cur.id, i: vi, plan, moved: false };
        schedule();
        return;
      }
      const ed = nearestEdge(cur, w.x, w.y, edgeTol);
      if (ed) {
        setSel({ kind: 'room', id: cur.id, ei: ed.i });
        dragRef.current = { mode: 'edge', id: cur.id, i: ed.i, wx: w.x, wy: w.y, orig: cur.pts, plan, moved: false };
        schedule();
        return;
      }
    }
    if (cur && s.kind === 'area') {
      const vi = nearestVertex(cur, w.x, w.y, tolFt);
      if (vi >= 0) { dragRef.current = { mode: 'avertex', id: cur.id, i: vi, plan, moved: false }; return; }
    }
    const filter = surfaceRef.current;
    const pin = hitSource(plan, w.x, w.y, tolFt * 0.9, filter);
    const obj = pin ? null : hitObject(plan, w.x, w.y, tolFt, filter);
    const mark = pin || obj ? null : hitMarkAt(plan, w.x, w.y, tolFt * 0.6);
    const picked = pickArea(plan, w.x, w.y, edgeTol * 1.4, filter);
    const room = hitRoom(plan, w.x, w.y);
    // an affected area is picked by its edge, or anywhere on it when no room is under it, so a wet room can still be selected
    const area = picked && (picked.onEdge || !room || (cur && s.kind === 'area' && cur.id === picked.area.id)) ? picked.area : null;
    // a pin, pen stroke or note lying on a room wins over the room under it
    if (pin) {
      setSel({ kind: 'source', id: pin.id });
      dragRef.current = { mode: 'move-pin', id: pin.id, wx: w.x, wy: w.y, orig: { x: pin.x, y: pin.y }, plan, moved: false };
    } else if (obj) {
      setSel({ kind: 'object', id: obj.id });
      dragRef.current = { mode: 'move-obj', id: obj.id, wx: w.x, wy: w.y, orig: { x: obj.x, y: obj.y, r: obj.r }, plan, moved: false };
    } else if (mark) {
      setSel({ kind: 'mark', id: mark.id });
      dragRef.current = { mode: 'move-mark', id: mark.id, wx: w.x, wy: w.y, orig: mark, plan, moved: false };
    } else if (area) {
      setSel({ kind: 'area', id: area.id });
      dragRef.current = { mode: 'move-area', id: area.id, wx: w.x, wy: w.y, orig: area.pts, plan, moved: false };
    } else if (room) {
      setSel({ kind: 'room', id: room.id });
      dragRef.current = { mode: 'move-room', id: room.id, wx: w.x, wy: w.y, orig: room.pts, plan, moved: false };
    } else {
      setSel(null);
      dragRef.current = { mode: 'pan', sx: p.x, sy: p.y, ox: v.ox, oy: v.oy };
    }
    schedule();
  }

  function onMove(e) {
    const v = viewRef.current;
    if (!pointers.current.has(e.pointerId)) {
      // no button down: show where a break or corner would go
      const t = toolRef.current;
      if (t === 'object') {
        const p = local(e);
        const w = toWorld(v, p.x, p.y);
        const type = objTypeRef.current;
        const pos = placeObject(planRef.current, type, w.x, w.y, { free: e.altKey });
        ghostRef.current = makeObject(type, pos.x, pos.y, { r: pos.r });
        schedule();
        return;
      }
      if (t === 'break' || t === 'corner') {
        const p = local(e);
        const w = toWorld(v, p.x, p.y);
        const plan = planRef.current;
        let h = null;
        for (let i = plan.rooms.length - 1; i >= 0 && !h; i -= 1) {
          const room = plan.rooms[i];
          const ed = nearestEdge(room, w.x, w.y, (9 / v.scale) * 1.3);
          if (ed) {
            const q = snapOnEdge(room.pts, ed.i, ed.x, ed.y);
            // the wall's two ends, so the length on each side of the circle can be shown
            h = { x: q.x, y: q.y, kind: t, a: room.pts[ed.i], b: room.pts[(ed.i + 1) % room.pts.length], pts: room.pts };
            const last = lastCornerRef.current;
            if (t === 'corner' && last && last.roomId === room.id && addCornerCut(room, ed.i, ed.x, ed.y, [last.x, last.y]).cut) {
              h.from = { x: last.x, y: last.y }; // the next click would cut the corner between the two
            }
          }
        }
        hoverRef.current = h;
        schedule();
      }
      return;
    }
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const d = dragRef.current;
    if (!d) return;

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
    const free = e.altKey || freeRef.current;
    const tolFt = 10 / v.scale;
    if (d.mode === 'pan') {
      viewRef.current = { ...v, ox: d.ox + (p.x - d.sx), oy: d.oy + (p.y - d.sy) };
    } else if (d.mode === 'room') {
      const x1 = snap(w.x); const y1 = snap(w.y);
      d.draft = { type: 'room', x: Math.min(d.x0, x1), y: Math.min(d.y0, y1), w: Math.abs(x1 - d.x0), h: Math.abs(y1 - d.y0) };
    } else if (d.mode === 'pen' || d.mode === 'area') {
      d.pts.push([w.x, w.y]);
      d.draft = d.mode === 'pen' ? { type: 'pen', color: colorRef.current, pts: d.pts } : { type: 'area', kind: areaRef.current.kind, cat: areaRef.current.cat, pts: d.pts };
    } else if (d.mode === 'move-room') {
      d.moved = true;
      // the first corner lands on the grid, so the whole room stays on it
      const [x0, y0] = d.orig[0];
      const dx = snap(x0 + (w.x - d.wx)) - x0;
      const dy = snap(y0 + (w.y - d.wy)) - y0;
      d.plan = { ...d.plan, rooms: d.plan.rooms.map((r) => (r.id === d.id ? { ...r, pts: translatePts(d.orig, dx, dy) } : r)) };
    } else if (d.mode === 'vertex') {
      d.moved = true;
      const room = d.plan.rooms.find((r) => r.id === d.id);
      const q = free ? { x: snap(w.x), y: snap(w.y) } : snapCorner(planRef.current, w.x, w.y, tolFt, { id: d.id, i: d.i });
      const base = planRef.current.rooms.find((r) => r.id === d.id) || room;
      d.plan = { ...d.plan, rooms: d.plan.rooms.map((r) => (r.id === d.id ? { ...r, pts: moveVertex(base.pts, d.i, q.x, q.y, { free }) } : r)) };
    } else if (d.mode === 'edge') {
      d.moved = true;
      // a wall always slides its ends along the walls beside it, with or without Angles / Alt: only corners move freely
      d.plan = { ...d.plan, rooms: d.plan.rooms.map((r) => (r.id === d.id ? { ...r, pts: moveEdgeSnapped(d.orig, d.i, w.x - d.wx, w.y - d.wy, { free: false }) } : r)) };
    } else if (d.mode === 'avertex') {
      d.moved = true;
      const base = planRef.current.areas.find((x) => x.id === d.id);
      const q = snapCorner(planRef.current, w.x, w.y, tolFt, null);
      d.plan = { ...d.plan, areas: d.plan.areas.map((x) => (x.id === d.id ? { ...x, pts: base.pts.map((pt, k) => (k === d.i ? [q.x, q.y] : pt)) } : x)) };
    } else if (d.mode === 'move-area') {
      d.moved = true;
      const [x0, y0] = d.orig[0];
      const dx = snap(x0 + (w.x - d.wx)) - x0;
      const dy = snap(y0 + (w.y - d.wy)) - y0;
      d.plan = { ...d.plan, areas: d.plan.areas.map((x) => (x.id === d.id ? { ...x, pts: translatePts(d.orig, dx, dy) } : x)) };
    } else if (d.mode === 'move-pin') {
      d.moved = true;
      const nx = snap(d.orig.x + (w.x - d.wx), 0.25);
      const ny = snap(d.orig.y + (w.y - d.wy), 0.25);
      d.plan = { ...d.plan, sources: d.plan.sources.map((x) => (x.id === d.id ? { ...x, x: nx, y: ny } : x)) };
    } else if (d.mode === 'move-obj') {
      d.moved = true;
      const o = d.plan.objects.find((x) => x.id === d.id);
      if (o) {
        const pos = placeObject(d.plan, o.t, d.orig.x + (w.x - d.wx), d.orig.y + (w.y - d.wy), { w: o.w, d: o.d, r: d.orig.r, free });
        d.plan = { ...d.plan, objects: d.plan.objects.map((x) => (x.id === d.id ? { ...x, x: pos.x, y: pos.y, r: pos.r } : x)) };
      }
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
    // a plain click on something (no drag) opens its editor next to the click
    if (p && ['move-room', 'vertex', 'edge', 'move-mark', 'avertex', 'move-area', 'move-pin', 'move-obj'].includes(d.mode) && !d.moved) openPopup(p.x, p.y);

    if (d.mode === 'room') {
      const dr = d.draft;
      if (dr && dr.w >= MIN_ROOM && dr.h >= MIN_ROOM && plan.rooms.length < MAX_ROOMS) {
        const room = { id: makeId(), label: '', notes: '', pts: rectPts(dr.x, dr.y, Math.min(dr.w, MAX_ROOM), Math.min(dr.h, MAX_ROOM)) };
        // the new room takes its space from any room it was drawn over
        const rect = { x: dr.x, y: dr.y, w: Math.min(dr.w, MAX_ROOM), h: Math.min(dr.h, MAX_ROOM) };
        const carved = carveRooms(plan.rooms, rect);
        commit({ ...plan, rooms: [...carved, room] });
        setSel({ kind: 'room', id: room.id });
        setTool('select');
        const c0 = toScreen(viewRef.current, dr.x + dr.w / 2, dr.y + dr.h / 2);
        openPopup(c0.x, c0.y); // a new room: name it right away
      }
    } else if (d.mode === 'pen') {
      const v = viewRef.current;
      const pts = simplifyStroke(d.pts, 2 / v.scale).map((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]);
      if (plan.marks.length < MAX_MARKS && pts.length) {
        const mark = { id: makeId(), type: 'pen', color: colorRef.current, pts };
        commit({ ...plan, marks: [...plan.marks, mark] });
      }
    } else if (d.mode === 'area') {
      const v = viewRef.current;
      const a = areaRef.current;
      const eps = Math.max(0.3, 9 / v.scale);
      const placed = a.kind === 'growth' && a.auto && !d.free ? placeGrowth(plan, d.pts, { mode: a.mode, eps }) : null;
      const pts = placed ? placed.pts : (a.kind === 'growth' && a.auto && !d.free ? null : cleanWater(d.pts, { mode: a.mode, eps }));
      if (pts && plan.areas.length < MAX_AREAS) {
        const area = newArea(pts, placed
          ? { kind: a.kind, smooth: placed.smooth, surfaces: placed.surfaces, height: a.height }
          : { kind: a.kind, cat: a.cat, smooth: a.mode === 'smooth', surfaces: a.surfaces, height: a.height });
        commit({ ...plan, areas: [...plan.areas, area] });
        setSel({ kind: 'area', id: area.id });
      }
    } else if (d.mode === 'text') {
      if (p && Math.hypot(p.x - d.sx, p.y - d.sy) < 8) setTextDraft({ x: snap(d.wx, 0.25), y: snap(d.wy, 0.25), value: '' });
    } else if (['move-room', 'vertex', 'edge', 'move-mark', 'avertex', 'move-area', 'move-pin', 'move-obj'].includes(d.mode) && d.moved && d.plan) {
      let next = d.plan;
      if (d.mode === 'vertex' || d.mode === 'edge') {
        // a corner or wall that now lines up with its neighbours leaves a stray point: drop it
        const room = next.rooms.find((r) => r.id === d.id);
        if (room) {
          const near = d.mode === 'vertex' ? [d.i - 1, d.i, d.i + 1] : [d.i - 1, d.i, d.i + 1, d.i + 2];
          const pts = dropStraightPoints(room.pts, near);
          if (pts.length !== room.pts.length) {
            next = { ...next, rooms: next.rooms.map((r) => (r.id === d.id ? { ...r, pts } : r)) };
            setSel({ kind: 'room', id: d.id });
          }
        }
      }
      commit(normalizePlan(next));
    }
    schedule();
  }

  // Double-click (or double-tap) a corner to remove it.
  function onDoubleClick(e) {
    if (toolRef.current !== 'select') return;
    const r = canvasRef.current.getBoundingClientRect();
    const v = viewRef.current;
    const w = toWorld(v, e.clientX - r.left, e.clientY - r.top);
    const tolFt = 12 / v.scale;
    const plan = planRef.current;
    const s = selRef.current;
    const order = [...plan.rooms].sort((a, b) => (b.id === s?.id) - (a.id === s?.id));
    for (const room of order) {
      const vi = nearestVertex(room, w.x, w.y, tolFt);
      if (vi < 0) continue;
      if (room.pts.length > 3) { patchRoom(room.id, { pts: removeVertex(room, vi).pts }); setSel({ kind: 'room', id: room.id }); }
      return;
    }
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

  // ---- full screen -------------------------------------------------------
  // The page is covered by the sketch (works everywhere); where the browser allows it, the whole screen is used too.
  function enterFull() {
    setFull(true);
    try { rootRef.current?.requestFullscreen?.()?.catch?.(() => {}); } catch { /* the covering layout is enough */ }
  }
  function exitFull() {
    setFull(false);
    try { if (document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {}); } catch { /* already out */ }
  }
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement && fullRef.current && usedNativeRef.current) setFull(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const usedNativeRef = useRef(false);
  useEffect(() => {
    usedNativeRef.current = full && !!document.fullscreenElement;
    if (!full) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => { usedNativeRef.current = !!document.fullscreenElement; fit(); }, 120); // refit to the bigger board
    return () => { document.body.style.overflow = prev; clearTimeout(t); };
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!full) { const t = setTimeout(() => fit(), 120); return () => clearTimeout(t); } return undefined; }, [full]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keyboard shortcuts ------------------------------------------------
  // V select, Space (hold) pan, R room, B wall break, C corner, W water, P pen, T text.
  // Delete removes the selection (or the selected corner), Ctrl+Z / Ctrl+Y undo and redo, Esc cancels.
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    if (inField(e.target)) return;
    const root = rootRef.current;
    const inside = root && root.contains(e.target);
    // from outside the sketch only when nothing else (a photo viewer, a dialog) is on top
    if (!inside && (e.target !== document.body || document.querySelector('.pv-overlay, .popup-overlay, .camera-overlay, .markup-overlay'))) return;
    if (e.code === 'Space' || e.key === ' ') { // hold Space to pan from any tool
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); // no page scroll, and no click on a focused tool button
      if (!e.repeat && !spaceRef.current && !dragRef.current && !textDraft) { spaceRef.current = { back: toolRef.current }; setTool('pan'); }
      return;
    }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current) { e.preventDefault(); removeSelected(); return; }
    if (e.key === 'Escape') {
      if (popupRef.current) { closePopup(); return; }
      if (toolRef.current === 'corner' && lastCornerRef.current) { lastCornerRef.current = null; schedule(); return; } // drop the first click, stay in the tool
      if (dragRef.current) { dragRef.current = null; pointers.current.clear(); }
      if (textDraft) { setTextDraft(null); return; }
      if (toolRef.current !== 'select') { setTool('select'); hoverRef.current = null; schedule(); return; }
      if (fullRef.current) exitFull();
      return;
    }
    if (KEYS[k]) { e.preventDefault(); setTool(KEYS[k]); setTextDraft(null); if (k === 'w') setAreaKind('water'); }
  };
  useEffect(() => {
    const h = (e) => keyRef.current?.(e);
    const release = () => { const s = spaceRef.current; if (s) { spaceRef.current = null; setTool(s.back); } };
    const up = (e) => { if (e.code === 'Space' || e.key === ' ') { if (spaceRef.current) e.preventDefault(); release(); } };
    window.addEventListener('keydown', h);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('keyup', up); window.removeEventListener('blur', release); };
  }, []);

  // ---- dimension entry ---------------------------------------------------
  function setDim(which, text) {
    if (!selected || sel.kind !== 'room' || !isRect(selected)) return;
    const ft = parseFeet(text);
    if (!Number.isFinite(ft) || ft < MIN_ROOM || ft > MAX_ROOM) { setDimErr(`Enter a size between ${MIN_ROOM} and ${MAX_ROOM} feet, like 12 or 12'6".`); return; }
    setDimErr('');
    const b = roomBox(selected);
    patchRoom(selected.id, resizeRect(selected, which === 'w' ? ft : b.w, which === 'h' ? ft : b.h));
  }
  function setWallLength(text) {
    if (!selected || sel.kind !== 'room' || sel.ei == null) return;
    const ft = parseFeet(text);
    if (!Number.isFinite(ft) || ft < 0.5 || ft > MAX_ROOM) { setDimErr(`Enter a length between 0.5 and ${MAX_ROOM} feet, like 12 or 12'6".`); return; }
    setDimErr('');
    patchRoom(selected.id, { pts: setEdgeLength(selected.pts, sel.ei, ft) });
  }

  // ---- export ------------------------------------------------------------
  function renderExport() {
    const plan = planRef.current;
    const b = planBounds(plan);
    if (!b) return null;
    const W = 1600;
    const H = Math.round(clampN(1600 * ((b.maxY - b.minY + 4) / Math.max(b.maxX - b.minX + 4, 4)), 500, 2400));
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    const view = fitView(b, W, H, 60);
    drawPlan(ctx, plan, view, { W, H, counts: {}, affected: totalsFor(plan).rooms, surface: 'all', grid: true });
    return out;
  }
  function download(blob, ext) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportName.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'sketch'}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function exportAs(kind) {
    setExportOpen(false);
    const out = renderExport();
    if (!out) return;
    if (kind === 'png') {
      out.toBlob((blob) => { if (blob) download(blob, 'png'); }, 'image/png');
      return;
    }
    out.toBlob(async (blob) => {
      if (!blob) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      download(new Blob([jpegToPdf(bytes, out.width, out.height, exportName)], { type: 'application/pdf' }), 'pdf');
    }, 'image/jpeg', 0.92);
  }
  const plan = planRef.current;
  const hasContent = !!(plan.rooms.length || plan.marks.length || plan.areas.length || plan.sources.length || plan.objects.length);
  const total = totalArea(plan);
  const totals = totalsFor(plan);
  const room = selected && sel.kind === 'room' ? selected : null;
  const mark = selected && sel.kind === 'mark' ? selected : null;
  const obj = selected && sel.kind === 'object' ? selected : null;
  const area = selected && sel.kind === 'area' ? selected : null;
  const pin = selected && sel.kind === 'source' ? selected : null;
  const roomPhotos = room ? photoCounts[room.id] || 0 : 0;
  const rect = room ? isRect(room) : false;
  const box = room ? roomBox(room) : null;
  const wallIdx = room && sel.ei != null && sel.ei < room.pts.length ? sel.ei : null;
  const wallLen = wallIdx != null ? edgeLength(room.pts, wallIdx) : 0;
  const roomAffected = room ? totals.rooms[room.id] : null;
  const showPop = !!(popup && selected);
  const areaStat = showPop && area ? affectedTotals({ ...plan, areas: [area] }).total[area.kind] : null;
  const { W: stageW, H: stageH } = sizeRef.current;
  const narrow = stageW < 520;
  const popStyle = !showPop ? null : narrow
    ? { left: 8, right: 8, bottom: 8, maxHeight: '75%' }
    : { left: clampN(popup.x + 14, 8, Math.max(8, stageW - 300 - 8)), top: clampN(popup.y + 14, 8, Math.max(8, stageH - 300)), width: 300, maxHeight: stageH - 16 };
  const textPos = textDraft ? toScreen(viewRef.current, textDraft.x, textDraft.y) : null;
  const textStyle = !textDraft ? null : narrow
    ? { left: 8, right: 8, bottom: 8 }
    : { left: clampN(textPos.x, 8, Math.max(8, stageW - 280 - 8)), top: clampN(textPos.y + 10, 8, Math.max(8, stageH - 110)), width: 280 };

  function pickObject(id) {
    setObjType(id);
    objTypeRef.current = id;
    setTool('object');
    setTextDraft(null);
    setObjMenu(false);
  }
  function pickKind(kind) {
    setAreaKind(kind);
    setTool('area');
    setTextDraft(null);
    setMenuOpen(false);
  }

  const closeBtn = <button type="button" className="sk-x" aria-label="Close" onClick={closePopup}>{'\u00d7'}</button>;

  const headBtns = (
    <span className="sketch-head-tools">
      <button type="button" className="sk-icon" onClick={() => setExportOpen(true)} disabled={!hasContent} aria-label="Export" title="Export"><UploadIcon /></button>
      <button type="button" className="sk-icon" onClick={full ? exitFull : enterFull} aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen (Esc)' : 'Full screen'}><FullIcon on={full} /></button>
    </span>
  );

  return (
    <div className={`sketch${full ? ' sketch-full' : ''}`} ref={rootRef} tabIndex={-1}>
      {(full || !headSlot) && <div className="sketch-head-inline">{headBtns}</div>}
      {!full && headSlot && createPortal(headBtns, headSlot)}

      <div className="sketch-stage" ref={wrapRef}>
        <div className="sketch-over sketch-over-tl">
          <div className="sketch-tools" role="toolbar" aria-label="Sketch tools">
            {TOOLS.map(([k, label, key]) => (k === 'object' ? (
              <div key={k} className="sketch-menu">
                <button type="button" className={tool === 'object' ? 'on' : ''} aria-haspopup="menu" aria-expanded={objMenu} title={`${label} (${key})`} onClick={() => { setMenuOpen(false); setObjMenu(!objMenu); }}>
                  {label}<span className="sk-caret" aria-hidden="true" />
                </button>
                {objMenu && (
                  <div className="sketch-menu-list sk-objects" role="menu">
                    {OBJECT_GROUPS.map((g) => (
                      <div key={g} className="sk-obj-group">
                        <div className="sk-obj-head">{g}</div>
                        <div className="sk-obj-grid">
                          {Object.entries(OBJECT_TYPES).filter(([, t]) => t.group === g).map(([id, t]) => (
                            <button key={id} type="button" role="menuitem" className={tool === 'object' && objType === id ? 'on' : ''} onClick={() => pickObject(id)}>{t.label}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : k === 'area' ? (
              <div key={k} className="sketch-menu">
                <button type="button" className={tool === 'area' ? 'on' : ''} aria-haspopup="menu" aria-expanded={menuOpen} title={`${label} (${key})`} onClick={() => { setObjMenu(false); setMenuOpen(!menuOpen); }}>
                  {label}<span className="sk-caret" aria-hidden="true" />
                </button>
                {menuOpen && (
                  <div className="sketch-menu-list" role="menu">
                    {KIND_ORDER.map((kind) => (
                      <button key={kind} type="button" role="menuitem" className={tool === 'area' && areaKind === kind ? 'on' : ''} onClick={() => pickKind(kind)}>
                        <span className="sk-dot" style={{ background: kindDot(kind) }} />{AREA_KINDS[kind]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button key={k} type="button" className={tool === k ? 'on' : ''} aria-pressed={tool === k} title={`${label} (${key})`} onClick={() => { setTool(k); setTextDraft(null); }}>
                {label}
              </button>
            )))}
            <button type="button" onClick={addRoom} disabled={plan.rooms.length >= MAX_ROOMS}>+ Room</button>
            <button type="button" className={freeAngle ? 'on' : ''} aria-pressed={freeAngle} title="Angles: move corners in any direction instead of keeping square walls square (or hold Alt). Walls always slide along their neighbours." onClick={() => setFreeAngle(!freeAngle)}>Angles</button>
            <select className="sketch-view" value={surfaceView} onChange={(e) => setSurfaceView(e.target.value)} aria-label="Surface to show" title="Which surface to show">
              {SURFACE_VIEWS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          {tool === 'area' && (
            <div className="sketch-strip" aria-label="Affected area options">
              <span className="sk-strip-kind"><span className="sk-dot" style={{ background: kindDot(areaKind) }} /><strong>{AREA_KINDS[areaKind]}</strong></span>
              {areaKind === 'water' && <CatChips value={waterCat} onChange={setWaterCat} />}
              {areaKind === 'growth' && (
                <div className="chips" role="group" aria-label="Where growth goes" title="Auto: a line snaps to the nearest wall, a loop to the nearest ceiling. Hold Alt while drawing to skip the snap.">
                  <button type="button" className={growthAuto ? 'on' : ''} aria-pressed={growthAuto} onClick={() => setGrowthAuto(true)}>Auto</button>
                  <button type="button" className={growthAuto ? '' : 'on'} aria-pressed={!growthAuto} onClick={() => setGrowthAuto(false)}>Manual</button>
                </div>
              )}
              {areaKind !== 'source' && !(areaKind === 'growth' && growthAuto) && <SurfaceChips value={surfaces} onChange={setSurfaces} />}
              {areaKind !== 'source' && (areaKind === 'growth' && growthAuto ? true : surfaces.includes('wall')) && (<><span className="muted">up the wall</span><HeightChips value={wallHeight} onChange={setWallHeight} /></>)}
              {areaKind === 'growth' && growthAuto && <span className="muted">Draw a line along a wall or a loop for the ceiling.</span>}
              {areaKind !== 'source' && (
                <div className="chips" role="group" aria-label="Line cleanup">
                  {[['smooth', 'Rounded'], ['straight', 'Straight']].map(([m, label]) => (
                    <button key={m} type="button" className={areaMode === m ? 'on' : ''} aria-pressed={areaMode === m} onClick={() => setAreaMode(m)}>{label}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {tool === 'object' && (
            <div className="sketch-strip sk-info" aria-label="Object options">
              <strong>{OBJECT_TYPES[objType].label}</strong>
              <span className="muted">{OBJECT_TYPES[objType].mode === 'wall' || OBJECT_TYPES[objType].mode === 'wallpoint' ? 'click a wall' : 'click to place'} · Alt: free</span>
            </div>
          )}
          {(tool === 'pen' || tool === 'text') && (
            <div className="sketch-strip">
              <span className="muted">Color</span>
              <div className="sketch-colors">
                {MARK_COLORS.map((col) => (
                  <button key={col} type="button" className={color === col ? 'on' : ''} style={{ background: col }} aria-label={`Color ${col}`} onClick={() => setColor(col)} />
                ))}
              </div>
            </div>
          )}

        </div>
        <div className="sketch-over sketch-over-tr" role="toolbar" aria-label="Undo and zoom">
          <button type="button" className="sk-icon" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><UndoIcon /></button>
          <button type="button" className="sk-icon" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Y)"><RedoIcon /></button>
          <button type="button" className="sk-icon" onClick={() => zoomCenter(1.3)} aria-label="Zoom in" title="Zoom in"><PlusIcon /></button>
          <button type="button" className="sk-icon" onClick={() => zoomCenter(1 / 1.3)} aria-label="Zoom out" title="Zoom out"><MinusIcon /></button>
          <button type="button" className="sk-icon" onClick={fit} aria-label="Fit to screen" title="Fit to screen"><FitIcon /></button>
        </div>

        <canvas
          ref={canvasRef}
          className={`sketch-canvas tool-${tool}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onDoubleClick={onDoubleClick}
          onPointerLeave={() => { if (hoverRef.current || ghostRef.current) { hoverRef.current = null; ghostRef.current = null; schedule(); } }}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Sketch drawing area"
        />

        {textDraft && (
          <form className="sketch-pop" style={textStyle} onSubmit={addText}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="sk-text">Note</label>
              <input id="sk-text" autoFocus maxLength={60} value={textDraft.value} onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })} placeholder="Door, wet wall, sump..." />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary small">Add</button>
              <button type="button" className="secondary small" onClick={() => setTextDraft(null)}>Cancel</button>
            </div>
          </form>
        )}

        {showPop && (
          <div className="sketch-pop" ref={popRef} style={popStyle} role="dialog" aria-label="Edit selection">
            {room && (
              <>
                <div className="sketch-pop-head"><strong>Room</strong>{closeBtn}</div>
                <div className="field"><label htmlFor="sk-room-name">Name</label>
                  <input id="sk-room-name" list="sk-room-presets" key={`${room.id}-l-${room.label}`} defaultValue={room.label} maxLength={40} onBlur={(e) => e.target.value !== room.label && patchRoom(room.id, { label: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} placeholder="Kitchen" />
                  <datalist id="sk-room-presets">{ROOM_PRESETS.map((n) => <option key={n} value={n} />)}</datalist>
                </div>
                {rect ? (
                  <div className="grid2">
                    <div className="field"><label htmlFor="sk-room-w">Width</label>
                      <input id="sk-room-w" key={`${room.id}-w-${box.w}`} inputMode="decimal" defaultValue={fmtFeet(box.w)} onBlur={(e) => setDim('w', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                    </div>
                    <div className="field"><label htmlFor="sk-room-h">Length</label>
                      <input id="sk-room-h" key={`${room.id}-h-${box.h}`} inputMode="decimal" defaultValue={fmtFeet(box.h)} onBlur={(e) => setDim('h', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                    </div>
                  </div>
                ) : (
                  <div className="muted">{room.pts.length} corners, about {roomSizeText(room)}. Click a wall to set its length.</div>
                )}
                {wallIdx != null && (
                  <div className="field"><label htmlFor="sk-wall-len">Selected wall</label>
                    <input id="sk-wall-len" key={`${room.id}-wl-${wallIdx}-${wallLen}`} inputMode="decimal" defaultValue={fmtFeet(wallLen)} onBlur={(e) => setWallLength(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  </div>
                )}
                {dimErr && <div className="msg err" style={{ margin: 0 }}>{dimErr}</div>}
                <div className="muted">{roomAreaText(room)}</div>
                {roomAffected && ['water', 'growth', 'smoke'].filter((kd) => roomAffected[kd]).map((kd) => (
                  <div key={kd} className="sk-aff" style={{ color: kindDot(kd) }}><strong>{AREA_KINDS[kd]}</strong> {surfaceText(roomAffected[kd])} sq ft</div>
                ))}
                <div className="field"><label htmlFor="sk-room-notes">Notes</label>
                  <input id="sk-room-notes" key={`${room.id}-n-${room.notes}`} defaultValue={room.notes} maxLength={300} onBlur={(e) => e.target.value !== room.notes && patchRoom(room.id, { notes: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} placeholder="Hardwood, wet along north wall" />
                </div>
                <div className="row">
                  {onAddRoomPhoto && <button type="button" className="secondary small" onClick={() => onAddRoomPhoto(room)}>Add photo</button>}
                  {onViewRoomPhotos && roomPhotos > 0 && <button type="button" className="secondary small" onClick={() => onViewRoomPhotos(room)}>Photos ({roomPhotos})</button>}
                  {sel.vi != null && sel.vi >= 0 && room.pts.length > 3 && <button type="button" className="secondary small" onClick={removeSelected}>Remove corner</button>}
                  <button type="button" className="danger small" onClick={() => { commit({ ...planRef.current, rooms: planRef.current.rooms.filter((r) => r.id !== room.id) }); setSel(null); setPopup(null); }}>Delete</button>
                </div>
                <details className="sk-more">
                  <summary>More</summary>
                  <div className="row">
                    <button type="button" className="secondary small" onClick={duplicateRoom}>Duplicate</button>
                    {rect && <button type="button" className="secondary small" onClick={() => patchRoom(room.id, resizeRect(room, box.h, box.w))}>Swap width and length</button>}
                    {!rect && <button type="button" className="secondary small" onClick={() => patchRoom(room.id, { pts: tidyPts(room.pts) })}>Tidy corners</button>}
                  </div>
                </details>
              </>
            )}

            {area && (
              <>
                <div className="sketch-pop-head"><strong><span className="sk-dot" style={{ background: kindDot(area.kind === 'water' ? 'water' : area.kind) }} />{AREA_KINDS[area.kind]}</strong>{closeBtn}</div>
                <div className="chips" role="group" aria-label="Type">
                  {['water', 'growth', 'smoke'].map((kd) => (
                    <button key={kd} type="button" className={area.kind === kd ? 'on' : ''} aria-pressed={area.kind === kd} onClick={() => patchArea(area.id, { kind: kd, cat: kd === 'water' ? area.cat : 1 })}>{AREA_KINDS[kd]}</button>
                  ))}
                </div>
                {area.kind === 'water' && <CatChips value={area.cat} onChange={(n) => patchArea(area.id, { cat: n })} />}
                <div className="muted sk-label">Surfaces</div>
                <SurfaceChips value={area.surfaces} onChange={(next) => patchArea(area.id, { surfaces: next })} />
                {area.surfaces.includes('wall') && (<><div className="muted sk-label">Up the wall</div><HeightChips value={area.height} onChange={(h) => patchArea(area.id, { height: h })} /></>)}
                <div className="muted">{areaStat ? `${surfaceText(areaStat)} sq ft` : 'Not inside any room yet.'} Drag the corners to adjust, or the shape to move it.</div>
                <div className="row">
                  <div className="chips" role="group" aria-label="Line cleanup" style={{ margin: 0 }}>
                    {[['smooth', 'Rounded'], ['straight', 'Straight']].map(([m, label]) => (
                      <button key={m} type="button" className={(area.smooth ? 'smooth' : 'straight') === m ? 'on' : ''} onClick={() => patchArea(area.id, { smooth: m === 'smooth' })}>{label}</button>
                    ))}
                  </div>
                  <button type="button" className="danger small" onClick={removeSelected}>Delete</button>
                </div>
              </>
            )}

            {pin && (
              <>
                <div className="sketch-pop-head"><strong><span className="sk-dot" style={{ background: kindDot('source') }} />Source of loss</strong>{closeBtn}</div>
                <div className="field"><label htmlFor="sk-pin-note">Note</label>
                  <input id="sk-pin-note" key={`${pin.id}-${pin.note}`} defaultValue={pin.note} maxLength={80} onBlur={(e) => e.target.value !== pin.note && patchSource(pin.id, { note: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} placeholder="Supply line, roof leak..." />
                </div>
                <div className="row"><button type="button" className="danger small" onClick={removeSelected}>Delete</button></div>
              </>
            )}

            {obj && (() => {
              const ot = OBJECT_TYPES[obj.t];
              const isWall = ot.mode === 'wall';
              const feet = (id, label, value, key, min = 0.1, max = 100) => (
                <div className="field" key={key}><label htmlFor={id}>{label}</label>
                  <input id={id} key={`${obj.id}-${key}-${value}`} inputMode="decimal" defaultValue={fmtFeet(value)}
                    onBlur={(e) => { const ft = parseFeet(e.target.value); if (Number.isFinite(ft) && ft >= min && ft <= max) { if (Math.abs(ft - value) > 1e-6) patchObject(obj.id, { [key]: Math.round(ft * 100) / 100 }); } else e.target.value = fmtFeet(value); }}
                    onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                </div>
              );
              return (
                <>
                  <div className="sketch-pop-head"><strong>{ot.label}</strong>{closeBtn}</div>
                  <div className="field"><label htmlFor="sk-obj-label">Label</label>
                    <input id="sk-obj-label" key={`${obj.id}-l-${obj.label}`} defaultValue={obj.label} maxLength={40} placeholder={ot.label} onBlur={(e) => e.target.value !== obj.label && patchObject(obj.id, { label: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  </div>
                  {ot.mode !== 'wallpoint' && (
                    <div className="grid2">
                      {feet('sk-obj-w', isWall ? 'Width' : ot.mode === 'box' ? 'Length' : 'Size', obj.w, 'w')}
                      {ot.mode === 'box' && feet('sk-obj-d', 'Depth', obj.d, 'd')}
                    </div>
                  )}
                  {ot.h != null && feet('sk-obj-h', ot.kind === 'window' ? 'Sill height' : 'Height off floor', obj.h ?? ot.h, 'h', 0, 30)}
                  <div className="field"><label htmlFor="sk-obj-note">Note</label>
                    <input id="sk-obj-note" key={`${obj.id}-n-${obj.note}`} defaultValue={obj.note} maxLength={80} placeholder="Brand, material, size..." onBlur={(e) => e.target.value !== obj.note && patchObject(obj.id, { note: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  </div>
                  <div className="row">
                    {ot.mode === 'box' && <button type="button" className="secondary small" onClick={() => patchObject(obj.id, { r: (obj.r + 90) % 360 })}>Rotate</button>}
                    {(isWall || ot.mode === 'wallpoint' || ot.kind === 'stairs') && <button type="button" className="secondary small" onClick={() => patchObject(obj.id, { f: !obj.f })}>{ot.kind === 'stairs' ? 'Flip direction' : isWall ? 'Flip side' : 'Flip'}</button>}
                    {ot.kind === 'door' && <button type="button" className="secondary small" onClick={() => patchObject(obj.id, { m: !obj.m })}>Flip hinge</button>}
                    <button type="button" className="secondary small" onClick={() => duplicateObject(obj)}>Duplicate</button>
                    <button type="button" className="danger small" onClick={removeSelected}>Delete</button>
                  </div>
                </>
              );
            })()}

            {mark && (
              <>
                <div className="sketch-pop-head"><strong>{mark.type === 'text' ? 'Note' : 'Pen line'}</strong>{closeBtn}</div>
                {mark.type === 'text' && (
                  <div className="field"><label htmlFor="sk-mark-text">Text</label>
                    <input id="sk-mark-text" key={mark.id} defaultValue={mark.text} maxLength={60} onBlur={(e) => e.target.value.trim() && e.target.value !== mark.text && patchMark(mark.id, { text: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  </div>
                )}
                <div className="sketch-colors">
                  {MARK_COLORS.map((col) => (
                    <button key={col} type="button" className={mark.color === col ? 'on' : ''} style={{ background: col }} aria-label={`Color ${col}`} onClick={() => patchMark(mark.id, { color: col })} />
                  ))}
                </div>
                <div className="row"><button type="button" className="danger small" onClick={removeSelected}>Delete</button></div>
              </>
            )}
          </div>
        )}
      </div>

      {exportOpen && (
        <div className="sketch-modal" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) setExportOpen(false); }}>
          <div className="sketch-modal-card" role="dialog" aria-label="Export sketch">
            <div className="sketch-pop-head"><strong>Export sketch</strong><button type="button" className="sk-x" aria-label="Close" onClick={() => setExportOpen(false)}>{'\u00d7'}</button></div>
            <button type="button" className="secondary" onClick={() => exportAs('png')}>Export as PNG</button>
            <button type="button" className="secondary" onClick={() => exportAs('pdf')}>Export as PDF</button>
          </div>
        </div>
      )}
      <div className="sketch-summary">
        {plan.rooms.length} room{plan.rooms.length === 1 ? '' : 's'}{plan.rooms.length > 0 && <> · {total.toLocaleString()} sq ft total</>}
        {['water', 'growth', 'smoke'].filter((kd) => totals.total[kd]).map((kd) => (
          <span key={kd}> · <strong style={{ color: kindDot(kd) }}>{AREA_KINDS[kd]} {surfaceText(totals.total[kd])} sq ft</strong></span>
        ))}
        {plan.objects.length > 0 && <> · <span title={objectCounts(plan).map((c) => `${c.count} ${c.label.toLowerCase()}`).join(', ')}>{plan.objects.length} object{plan.objects.length === 1 ? '' : 's'}</span></>}
        {plan.sources.length > 0 && <> · <strong style={{ color: kindDot('source') }}>{plan.sources.length} source{plan.sources.length === 1 ? '' : 's'} of loss</strong></>}
        <span className="muted"> · {tool === 'area' ? AREA_HINTS[areaKind] : HINTS[tool]}</span>
      </div>
    </div>
  );
}
