'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Signing happens on a full-screen landscape pad. Tapping the box opens it and asks the device to turn
// landscape (Android and iPad can be told to; an iPhone cannot). Where the phone stays upright, the pad is
// drawn turned on its side so it is already landscape: the person just turns the phone to match.
// Calls onChange with a PNG data URL once Done is tapped, and with null when cleared.

// Optional extras: nameField { label, value, onChange } puts a name box above the pad (Done then also needs a name),
// doneLabel renames Done, extra is a node shown beside the name box, error is a line of text shown under the bar.
export function SignOverlay({ onDone, onCancel, nameField = null, doneLabel = 'Done', extra = null, error = '' }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [has, setHas] = useState(false);
  const hasRef = useRef(false);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const portrait = view.h > view.w;
  const cancelRef = useRef(onCancel); // the parent may pass a new function each render (typing a name); setup below must not re-run for it
  cancelRef.current = onCancel;

  // follow the screen turning
  useEffect(() => {
    const onSize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onSize);
    window.addEventListener('orientationchange', onSize);
    return () => { window.removeEventListener('resize', onSize); window.removeEventListener('orientationchange', onSize); };
  }, []);

  // ask for full screen + landscape, keep the page behind from scrolling
  useEffect(() => {
    let fs = false;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (async () => {
      try {
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) { await document.documentElement.requestFullscreen(); fs = true; }
      } catch { /* not allowed here: fine */ }
      try { await window.screen?.orientation?.lock?.('landscape'); } catch { /* not supported: the pad is turned instead */ }
    })();
    const onKey = (e) => { if (e.key === 'Escape') cancelRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      try { window.screen?.orientation?.unlock?.(); } catch { /* ignore */ }
      if (fs && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  // size the canvas to its box; keep what is already drawn if the box changes (the phone was turned)
  const fit = useCallback(() => {
    const c = canvasRef.current;
    const box = wrapRef.current;
    if (!c || !box) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (!w || !h) return;
    const ratio = window.devicePixelRatio || 1;
    let snapshot = null;
    if (hasRef.current && c.width > 0) {
      snapshot = document.createElement('canvas');
      snapshot.width = c.width;
      snapshot.height = c.height;
      snapshot.getContext('2d').drawImage(c, 0, 0);
    }
    c.width = Math.round(w * ratio);
    c.height = Math.round(h * ratio);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    if (snapshot) ctx.drawImage(snapshot, 0, 0, c.width, c.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
  }, []);

  useEffect(() => { fit(); }, [fit, portrait, view.w, view.h]);

  // pointer position in the canvas's own pixels, allowing for the pad being turned 90 degrees
  const point = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    if (!portrait) return { x: e.clientX - r.left, y: e.clientY - r.top };
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return { x: c.offsetWidth / 2 + (e.clientY - cy), y: c.offsetHeight / 2 - (e.clientX - cx) };
  };

  function down(e) {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.4, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
  }
  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const p = point(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    hasRef.current = true;
    setHas(true);
  }
  function clear() {
    hasRef.current = false;
    setHas(false);
    fit();
  }

  const stage = portrait
    ? { position: 'absolute', top: 0, left: view.w, width: view.h, height: view.w, transformOrigin: 'top left', transform: 'rotate(90deg)' }
    : { position: 'absolute', inset: 0 };

  return createPortal(
    <div className="sig-full" role="dialog" aria-modal="true" aria-label="Signature">
      <div className="sig-stage" style={stage}>
        <div className="sig-bar">
          <strong>Sign below</strong>
          {portrait && <span className="sig-turn">Turn your phone sideways to sign</span>}
          <span style={{ flex: 1 }} />
          <button type="button" className="secondary" onClick={clear} disabled={!has}>Clear</button>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" disabled={!has || (nameField && nameField.value.trim().length < 2)} onClick={() => onDone(canvasRef.current.toDataURL('image/png'))}>{doneLabel}</button>
        </div>
        {(nameField || extra) && (
          <div className="sig-namebar">
            {nameField && (
              <label className="sig-name">
                <span>{nameField.label}</span>
                <input value={nameField.value} onChange={(e) => nameField.onChange(e.target.value)} autoComplete="off" placeholder="Type full name" />
              </label>
            )}
            {extra}
          </div>
        )}
        {error && <div className="msg err sig-error">{error}</div>}
        <div className="sig-area" ref={wrapRef}>
          <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          <div className="sig-line" />
          {!has && <span className="sig-x">X</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function SignaturePad({ onChange }) {
  const [url, setUrl] = useState(null);
  const [open, setOpen] = useState(false);

  const done = useCallback((u) => { setUrl(u); onChange(u); setOpen(false); }, [onChange]);
  const cancel = useCallback(() => setOpen(false), []);

  return (
    <div>
      <button type="button" className="sig-pad sig-preview" onClick={() => setOpen(true)} aria-label={url ? 'Sign again' : 'Tap to sign'}>
        {url ? <img src={url} alt="Signature" /> : <span className="sig-hint-center">Tap to sign</span>}
      </button>
      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="secondary small" onClick={() => setOpen(true)}>{url ? 'Sign again' : 'Open signature pad'}</button>
        {url && <button type="button" className="secondary small" onClick={() => { setUrl(null); onChange(null); }}>Clear signature</button>}
      </div>
      {open && <SignOverlay onDone={done} onCancel={cancel} />}
    </div>
  );
}
