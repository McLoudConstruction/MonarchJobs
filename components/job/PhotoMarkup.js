'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSupabase } from '@/lib/supabaseClient';
import { PHOTO_BUCKET } from '@/lib/jobDocs';
import { uploadJobPhoto } from '@/lib/photoUpload';

const COLORS = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#2d7ff9', '#ffffff'];
const TOOLS = [['pen', 'Pen'], ['arrow', 'Arrow'], ['circle', 'Circle'], ['rect', 'Box'], ['text', 'Text']];
const MAX_SIDE = 1600;

function drawShape(ctx, a, unit) {
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = unit;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (a.type === 'pen') {
    ctx.beginPath();
    a.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    if (a.pts.length === 1) ctx.lineTo(a.pts[0][0] + 0.1, a.pts[0][1]);
    ctx.stroke();
  } else if (a.type === 'rect') {
    ctx.strokeRect(a.x, a.y, a.w, a.h);
  } else if (a.type === 'circle') {
    ctx.beginPath();
    ctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, Math.abs(a.w / 2), Math.abs(a.h / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (a.type === 'arrow') {
    const x2 = a.x + a.w; const y2 = a.y + a.h;
    const head = Math.max(14, unit * 5);
    const ang = Math.atan2(a.h, a.w);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
    ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
    ctx.closePath(); ctx.fill();
  } else if (a.type === 'text') {
    const fs = unit * 7;
    ctx.font = `700 ${fs}px -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.lineWidth = fs * 0.14;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(a.text, a.x, a.y);
    ctx.fillText(a.text, a.x, a.y);
  }
}

// Draw arrows, circles, boxes, handwriting and text on a photo. Saving adds a NEW photo (the original
// is never changed) that remembers which photo it came from.
export default function PhotoMarkup({ photo, onClose, onSaved }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const shapesRef = useRef([]);
  const dragRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [tool, setTool] = useState('arrow');
  const [color, setColor] = useState(COLORS[0]);
  const [count, setCount] = useState(0);
  const [textAt, setTextAt] = useState(null);
  const [textVal, setTextVal] = useState('');
  const [busy, setBusy] = useState(false);

  const unit = useCallback(() => Math.max(3, (canvasRef.current?.width || 1000) * 0.005), []);
  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !imgRef.current) return;
    const ctx = c.getContext('2d');
    ctx.drawImage(imgRef.current, 0, 0, c.width, c.height);
    const all = dragRef.current?.shape ? [...shapesRef.current, dragRef.current.shape] : shapesRef.current;
    all.forEach((a) => drawShape(ctx, a, unit()));
  }, [unit]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await getSupabase().storage.from(PHOTO_BUCKET).download(photo.storage_path);
        if (error || !data) throw new Error(error?.message || 'Could not open the photo.');
        const bmp = await createImageBitmap(data);
        if (!alive) return;
        const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
        const c = canvasRef.current;
        c.width = Math.round(bmp.width * s);
        c.height = Math.round(bmp.height * s);
        imgRef.current = bmp;
        setReady(true);
      } catch (e) {
        if (alive) setErr(e.message);
      }
    })();
    return () => { alive = false; };
  }, [photo.storage_path]);

  useEffect(() => { if (ready) redraw(); }, [ready, redraw]);

  const pos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };

  function down(e) {
    if (!ready) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    const [x, y] = pos(e);
    if (tool === 'text') { dragRef.current = { text: true, x, y }; return; }
    dragRef.current = { shape: tool === 'pen' ? { type: 'pen', color, pts: [[x, y]] } : { type: tool, color, x, y, w: 0, h: 0 }, x, y };
  }
  function move(e) {
    const d = dragRef.current;
    if (!d || d.text) return;
    const [x, y] = pos(e);
    if (d.shape.type === 'pen') d.shape.pts.push([x, y]);
    else { d.shape.w = x - d.x; d.shape.h = y - d.y; }
    redraw();
  }
  function up(e) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.text) { const [x, y] = pos(e); setTextAt([d.x, d.y]); setTextVal(''); void x; void y; return; }
    const s = d.shape;
    const tiny = s.type !== 'pen' && Math.abs(s.w) < 6 && Math.abs(s.h) < 6;
    if (!tiny) { shapesRef.current = [...shapesRef.current, s]; setCount(shapesRef.current.length); }
    redraw();
  }
  function addText(e) {
    e.preventDefault();
    if (textVal.trim() && textAt) {
      shapesRef.current = [...shapesRef.current, { type: 'text', color, x: textAt[0], y: textAt[1], text: textVal.trim().slice(0, 80) }];
      setCount(shapesRef.current.length);
      redraw();
    }
    setTextAt(null);
  }
  function undo() { shapesRef.current = shapesRef.current.slice(0, -1); setCount(shapesRef.current.length); redraw(); }

  async function save() {
    setBusy(true);
    setErr('');
    try {
      const blob = await new Promise((res, rej) => canvasRef.current.toBlob((b) => (b ? res(b) : rej(new Error('Could not save the picture.'))), 'image/jpeg', 0.9));
      const row = await uploadJobPhoto({
        sb: getSupabase(), jobId: photo.job_id, file: blob, kind: photo.kind, takenAt: photo.taken_at,
        caption: photo.caption ? `${photo.caption} (marked up)` : 'Marked up',
        sketchId: photo.sketch_id, roomKey: photo.room_key, derivedFrom: photo.id,
      });
      await onSaved(row);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="pv-overlay pv-markup" role="dialog" aria-modal="true" aria-label="Mark up photo">
      <div className="pv-top">
        <strong>Mark up photo</strong>
        <div className="row">
          <button type="button" className="secondary small" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="primary small" onClick={save} disabled={busy || !ready || count === 0}>{busy ? 'Saving...' : 'Save as new photo'}</button>
        </div>
      </div>
      <div className="pv-tools">
        {TOOLS.map(([k, l]) => <button key={k} type="button" className={tool === k ? 'on' : ''} onClick={() => { setTool(k); setTextAt(null); }}>{l}</button>)}
        <button type="button" onClick={undo} disabled={count === 0}>Undo</button>
        <span className="sketch-colors">
          {COLORS.map((c) => <button key={c} type="button" className={color === c ? 'on' : ''} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => setColor(c)} />)}
        </span>
      </div>
      {err && <div className="msg err" style={{ margin: '0 12px' }}>{err}</div>}
      {textAt && (
        <form className="pv-text" onSubmit={addText}>
          <input autoFocus value={textVal} onChange={(e) => setTextVal(e.target.value)} maxLength={80} placeholder="Type the note" />
          <button className="primary small">Add</button>
          <button type="button" className="secondary small" onClick={() => setTextAt(null)}>Cancel</button>
        </form>
      )}
      <div className="pv-stage">
        {!ready && !err && <p style={{ color: '#fff' }}>Opening photo...</p>}
        <canvas ref={canvasRef} className="pv-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { dragRef.current = null; redraw(); }} />
      </div>
    </div>,
    document.body,
  );
}
