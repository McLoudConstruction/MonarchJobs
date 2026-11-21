'use client';

import { useEffect, useRef, useState } from 'react';

// Scan the QR on an equipment label with the phone's camera. Calls onScan(text) once with whatever the code holds; the caller
// decides if it is a usable tag. If the live camera is not allowed or not available, "Take a photo of the tag" does the same job.
// Nothing is stored: the camera stream and any photo are dropped as soon as a code is read.

async function decodeImageData(img) {
  const { default: jsQR } = await import('jsqr');
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
}

export default function AssetScan({ onScan, onClose, title = 'Scan the asset tag' }) {
  const video = useRef(null);
  const work = useRef(null);
  const photo = useRef(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const done = useRef(false);

  function finish(text) {
    if (done.current) return;
    done.current = true;
    onScan(text);
  }

  useEffect(() => {
    let stream = null;
    let raf = 0;
    let live = true;
    let last = 0;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setErr('This phone will not open the camera here. Take a photo of the tag instead.'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (!live) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current;
        v.srcObject = stream;
        v.setAttribute('playsinline', 'true');
        await v.play();
        const tick = async (now) => {
          if (!live) return;
          raf = requestAnimationFrame(tick);
          if (now - last < 150 || !v.videoWidth) return; // a few looks a second is plenty and keeps the phone cool
          last = now;
          const c = work.current;
          const scale = Math.min(1, 720 / v.videoWidth);
          c.width = Math.round(v.videoWidth * scale);
          c.height = Math.round(v.videoHeight * scale);
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const hit = await decodeImageData(ctx.getImageData(0, 0, c.width, c.height));
          if (hit && hit.data && live) finish(hit.data);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        setErr(e && e.name === 'NotAllowedError' ? 'The camera is blocked. Allow it in the browser settings, or take a photo of the tag instead.' : 'The camera would not open. Take a photo of the tag instead.');
      }
    }
    start();
    return () => { live = false; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function fromPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = work.current;
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const hit = await decodeImageData(ctx.getImageData(0, 0, c.width, c.height));
      if (hit && hit.data) finish(hit.data);
      else setErr('No tag found in that photo. Get the QR square in the middle and try again.');
    } catch {
      setErr('That photo could not be read. Try again.');
    }
    setBusy(false);
  }

  return (
    <div className="sketch-modal" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sketch-modal-card sk-scan" role="dialog" aria-label={title}>
        <div className="sketch-pop-head"><strong>{title}</strong><button type="button" className="sk-x" aria-label="Close" onClick={onClose}>{'×'}</button></div>
        <div className="sk-scan-view">
          <video ref={video} muted playsInline />
          <i className="sk-scan-frame" aria-hidden="true" />
        </div>
        <canvas ref={work} hidden />
        {err ? <p className="sk-scan-err" role="alert">{err}</p> : <p className="muted" style={{ margin: 0 }}>Point the camera at the QR square on the label.</p>}
        <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={fromPhoto} />
        <div className="sk-eq-actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => photo.current?.click()}>Take a photo of the tag</button>
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
