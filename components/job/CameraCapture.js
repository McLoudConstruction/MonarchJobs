'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { KindChips, FilePick } from '@/components/job/PhotoUi';
import { PHOTO_KINDS } from '@/lib/jobDocs';

// Full-screen camera for rapid-fire shots. The live viewfinder stays open, so every tap of the shutter
// takes a picture and starts its upload while the camera is ready for the next one (the phone's own
// camera app closes after each shot). Uses the browser camera, which works on iPhone Safari and Android
// Chrome. If the camera is blocked or missing, it falls back to the phone's camera app.
export default function CameraCapture({ open, onClose, uploader }) {
  const [kind, setKind] = useState(null); // no folder until the person picks one
  const [facing, setFacing] = useState('environment');
  const [camError, setCamError] = useState('');
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const [shots, setShots] = useState([]); // { id, preview, kind, status }
  const video = useRef(null);
  const stream = useRef(null);
  const seq = useRef(0);
  const queue = useRef(Promise.resolve());
  const shotsRef = useRef([]);
  shotsRef.current = shots;
  const kindRef = useRef(null);
  kindRef.current = kind;

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setReady(false);
  }, []);

  // start (or restart, when flipping) the camera while the screen is open
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setCamError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('This browser cannot open the camera here.');
      return undefined;
    }
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1440 } },
        });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        const v = video.current;
        if (v) { v.srcObject = s; await v.play().catch(() => {}); }
        setReady(true);
      } catch (e) {
        if (!cancelled) {
          setCamError(e?.name === 'NotAllowedError'
            ? 'Camera access is blocked. Allow the camera for this site in your browser settings, or use your phone’s camera app below.'
            : 'The camera could not be started. You can use your phone’s camera app below.');
        }
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [open, facing, stop]);

  useEffect(() => { if (open) { setKind(null); setShots([]); } }, [open]);
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.preview)), []);

  // pictures are prepared and uploaded one at a time, in the order taken, so a burst of shots does not
  // overload the phone's memory or connection
  function enqueue(file, id, k) {
    queue.current = queue.current.then(() => uploader.upload([file], {
      kind: k,
      onItem: (_f, status) => setShots((list) => list.map((s) => (s.id === id ? { ...s, status } : s))),
    })).catch(() => {});
  }

  function addShot(file, k) {
    const id = ++seq.current;
    setShots((list) => [{ id, preview: URL.createObjectURL(file), kind: k, status: 'waiting' }, ...list]);
    enqueue(file, id, k);
  }

  function snap() {
    const v = video.current;
    if (!kindRef.current || !v || !v.videoWidth) return;
    const k = kindRef.current;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    setFlash(true);
    setTimeout(() => setFlash(false), 90);
    try { navigator.vibrate?.(15); } catch { /* not supported */ }
    c.toBlob((blob) => {
      if (!blob) return;
      addShot(new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }), k);
    }, 'image/jpeg', 0.92);
  }

  const pending = shots.filter((s) => s.status === 'waiting' || s.status === 'uploading').length;
  const saved = shots.filter((s) => s.status === 'done').length;
  const failed = shots.filter((s) => s.status === 'error').length;

  function close() {
    stop();
    onClose();
  }

  if (!open) return null;
  return (
    <div className="cam-overlay" role="dialog" aria-modal="true" aria-label="Take photos">
      <div className="cam-top">
        <div className="cam-title">Take photos</div>
        <button type="button" className="cam-done" onClick={close}>Done{pending ? ` (${pending} uploading)` : ''}</button>
      </div>
      <div className="cam-folder">
        <KindChips value={kind} onChange={setKind} />
      </div>

      <div className="cam-stage">
        {!camError && <video ref={video} className="cam-video" playsInline muted autoPlay />}
        {flash && <div className="cam-flash" />}
        {camError && (
          <div className="cam-fallback">
            <p>{camError}</p>
            <FilePick label={kind ? `Open camera app for ${PHOTO_KINDS[kind]}` : 'Pick a folder first'} capture className="primary" disabled={!kind}
              onFiles={(files) => files.forEach((f) => addShot(f, kind))} />
          </div>
        )}
        {!camError && !kind && <div className="cam-hint">Pick a folder to start shooting</div>}
      </div>

      <div className="cam-strip" aria-label="Photos taken">
        {shots.map((s) => (
          <div key={s.id} className={`cam-shot s-${s.status}`}>
            <img src={s.preview} alt="" />
            <span>{s.status === 'done' ? '✓' : s.status === 'error' ? '!' : '…'}</span>
          </div>
        ))}
      </div>

      <div className="cam-bar">
        <div className="cam-count" role="status">
          {shots.length ? `${saved} saved${pending ? `, ${pending} uploading` : ''}${failed ? `, ${failed} failed` : ''}` : kind ? PHOTO_KINDS[kind] : ''}
        </div>
        <button type="button" className="cam-shutter" onClick={snap} disabled={!kind || !ready} aria-label="Take photo" />
        <button type="button" className="cam-flip" onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')} disabled={!!camError} aria-label="Switch camera">Flip</button>
      </div>
    </div>
  );
}
