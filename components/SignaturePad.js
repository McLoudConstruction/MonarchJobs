'use client';

import { useEffect, useRef, useState } from 'react';

// A box to sign in with a finger or mouse. Calls onChange with a PNG data URL once something is
// drawn, and with null when cleared.
export default function SignaturePad({ onChange, height = 170 }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [has, setHas] = useState(false);

  function setup() {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const w = c.parentElement.clientWidth;
    c.width = Math.round(w * ratio);
    c.height = Math.round(height * ratio);
    c.style.height = `${height}px`;
    const ctx = c.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, height);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
  }

  useEffect(() => { setup(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e) {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
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
    setHas(true);
    onChange(canvasRef.current.toDataURL('image/png'));
  }

  function clear() {
    setup();
    setHas(false);
    onChange(null);
  }

  return (
    <div>
      <div className="sig-pad">
        {!has && <span className="sig-hint">Sign here</span>}
        <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
      </div>
      <button type="button" className="secondary small" style={{ marginTop: 6 }} onClick={clear}>Clear signature</button>
    </div>
  );
}
