'use client';
import { useMemo, useState } from 'react';
import PopupModal from '@/components/PopupModal';
import { FLOOR_TYPES, MAX_CEIL, MIN_CEIL, ROOM_TYPES, polyArea, polyBox, roomTitle } from '@/lib/sketch';
import { SHAPES, SHAPE_ORDER, SIDES, parseSize, roomFromSize, shapePts, turnPts } from '@/lib/roomShapes';

// Add a room by typing its size: "12 x 14", a shape (rectangle, L, T or U), and which wall of an existing room it sits against.
// onAdd(room) puts it on the plan and returns true when it was added.
export default function RoomBySize({ open, onClose, rooms, selectedId, onAdd, full }) {
  const [shape, setShape] = useState('rect');
  const [size, setSize] = useState('');
  const [cut, setCut] = useState('');
  const [turns, setTurns] = useState(0);
  const [type, setType] = useState('');
  const [other, setOther] = useState('');
  const [label, setLabel] = useState('');
  const [ceil, setCeil] = useState('');
  const [floor, setFloor] = useState('');
  const [side, setSide] = useState('right');
  const [nextId, setNextId] = useState(null); // undefined/null: follow the selected room (or the last one)
  const [err, setErr] = useState('');
  const [added, setAdded] = useState(0);

  const list = rooms || [];
  const anchorId = nextId !== null ? nextId : (selectedId && list.some((r) => r.id === selectedId) ? selectedId : (list.length ? list[list.length - 1].id : ''));
  const anchor = list.find((r) => r.id === anchorId) || null;

  const dims = useMemo(() => {
    const s = parseSize(size);
    const c = SHAPES[shape].cut ? parseSize(cut) : [0, 0];
    return { w: s ? s[0] : NaN, h: s ? s[1] : NaN, cw: c ? c[0] : NaN, cd: c ? c[1] : NaN, sizeOk: !!s, cutOk: !!c };
  }, [size, cut, shape]);

  const preview = useMemo(() => {
    const ok = dims.sizeOk && dims.cutOk && !roomFromSize([], { shape, ...dims, turns }).error;
    if (!ok) return null;
    const pts = turnPts(shapePts(shape, dims), shape === 'rect' ? 0 : turns);
    const b = polyBox(pts);
    return { pts, b, area: Math.round(polyArea(pts)) };
  }, [dims, shape, turns]);

  function reset(keepKind) {
    setSize(''); setCut(''); setLabel('');
    if (!keepKind) { setType(''); setOther(''); setCeil(''); setFloor(''); }
    setErr('');
  }

  function submit(another) {
    if (!dims.sizeOk) { setErr('Type the size as width x length, like 12 x 14 or 12\'6" x 10.'); return; }
    if (!dims.cutOk) { setErr(`Type the ${SHAPES[shape].cut.w.toLowerCase()} and ${SHAPES[shape].cut.d.toLowerCase()} as two sizes, like 4 x 3.`); return; }
    const c = ceil.trim() ? Number(ceil) : 0;
    if (ceil.trim() && !(c >= MIN_CEIL && c <= MAX_CEIL)) { setErr(`Ceiling height is between ${MIN_CEIL} and ${MAX_CEIL} feet.`); return; }
    const res = roomFromSize(list, { shape, ...dims, turns, type, other, label, ceil: c, floor }, anchor ? { nextTo: anchor, side } : {});
    if (res.error) { setErr(res.error); return; }
    if (!onAdd(res.room)) { setErr('This sketch is full. Remove a room first.'); return; }
    setErr('');
    setAdded((n) => n + 1);
    if (another) { setNextId(res.room.id); reset(true); } else { reset(false); setNextId(null); setAdded(0); onClose(); }
  }

  const close = () => { setNextId(null); setAdded(0); setErr(''); onClose(); };

  return (
    <PopupModal open={open} onClose={close} title="Add a room by size">
      <form className="rbs" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
        <div className="chips" role="group" aria-label="Shape">
          {SHAPE_ORDER.map((k) => <button key={k} type="button" className={shape === k ? 'on' : ''} aria-pressed={shape === k} onClick={() => { setShape(k); setErr(''); }}>{SHAPES[k].label}</button>)}
        </div>
        <div className="rbs-top">
          <div className="rbs-fields">
            <div className="field"><label htmlFor="rbs-size">Size (width x length, feet)</label>
              <input id="rbs-size" autoFocus inputMode="text" autoComplete="off" value={size} onChange={(e) => { setSize(e.target.value); setErr(''); }} placeholder={'12 x 14'} />
            </div>
            {SHAPES[shape].cut && (
              <div className="field"><label htmlFor="rbs-cut">{SHAPES[shape].cut.w} x {SHAPES[shape].cut.d.toLowerCase()}</label>
                <input id="rbs-cut" inputMode="text" autoComplete="off" value={cut} onChange={(e) => { setCut(e.target.value); setErr(''); }} placeholder={'4 x 3'} />
              </div>
            )}
            {shape !== 'rect' && (
              <div className="rbs-turn"><span className="muted">Turn</span>
                <div className="chips" role="group" aria-label="Turn the shape">
                  {[0, 1, 2, 3].map((t) => <button key={t} type="button" className={turns === t ? 'on' : ''} aria-pressed={turns === t} onClick={() => setTurns(t)}>{t * 90}{'°'}</button>)}
                </div>
              </div>
            )}
          </div>
          <div className="rbs-prev" aria-hidden="true">
            {preview ? (
              <>
                <svg viewBox={`-0.5 -0.5 ${preview.b.w + 1} ${preview.b.h + 1}`} preserveAspectRatio="xMidYMid meet">
                  <polygon points={preview.pts.map((p) => p.join(',')).join(' ')} fill="rgba(11,122,115,0.14)" stroke="currentColor" strokeWidth={Math.max(preview.b.w, preview.b.h) / 60} strokeLinejoin="round" />
                </svg>
                <div className="muted">{preview.area} sq ft</div>
              </>
            ) : <div className="muted">Type the size to see it</div>}
          </div>
        </div>

        <div className="grid2">
          <div className="field"><label htmlFor="rbs-type">Room type</label>
            <select id="rbs-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Choose a type...</option>
              {Object.entries(ROOM_TYPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="rbs-name">Name (optional)</label>
            <input id="rbs-name" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="Primary bedroom" />
          </div>
        </div>
        {type === 'other' && <div className="field"><label htmlFor="rbs-other">What kind of room</label><input id="rbs-other" value={other} maxLength={30} onChange={(e) => setOther(e.target.value)} placeholder="Sunroom" /></div>}
        <div className="grid2">
          <div className="field"><label htmlFor="rbs-ceil">Ceiling height (ft, optional)</label>
            <input id="rbs-ceil" inputMode="decimal" value={ceil} onChange={(e) => setCeil(e.target.value)} placeholder="8" />
          </div>
          <div className="field"><label htmlFor="rbs-floor">Floor</label>
            <select id="rbs-floor" value={floor} onChange={(e) => setFloor(e.target.value)}>
              <option value="">Not set</option>
              {Object.entries(FLOOR_TYPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </div>
        </div>

        {list.length > 0 && (
          <div className="rbs-place">
            <div className="muted">Where it goes</div>
            <div className="chips" role="group" aria-label="Side">
              {Object.entries(SIDES).map(([k, t]) => <button key={k} type="button" className={side === k ? 'on' : ''} aria-pressed={side === k} onClick={() => setSide(k)}>{t}</button>)}
            </div>
            <select aria-label="Room it goes against" value={anchorId} onChange={(e) => setNextId(e.target.value)}>
              {list.map((r) => <option key={r.id} value={r.id}>{r.num ? `#${r.num} ` : ''}{roomTitle(r)}</option>)}
            </select>
          </div>
        )}

        {err && <div className="msg err" style={{ margin: 0 }}>{err}</div>}
        <div className="row">
          <button className="primary" type="submit">Add room</button>
          <button type="button" className="secondary" onClick={() => submit(true)}>Add and keep going</button>
          {added > 0 && <span className="muted">{added} added</span>}
        </div>
        {full && <div className="muted">Rooms touch, so they share a wall. Drag a room afterwards to adjust.</div>}
      </form>
    </PopupModal>
  );
}
