'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import FolderPicker, { RoomPill } from '@/components/job/FolderPicker';
import { PHOTO_KIND_KEYS, PHOTO_KINDS } from '@/lib/jobDocs';
import PhotoMarkupEditor from '@/components/job/PhotoMarkupEditor';
import { FlashOnIcon, FlashOffIcon, FlipCameraIcon, EditIcon, UndoIcon } from '@/components/job/photoIcons';
import { useWaitingPhotos } from '@/lib/offlineClient';
import { gpsFromPosition, freshGps, splitRoomValue } from '@/lib/photoMeta';

// Full-screen in-browser camera that stays open across shots.
// Flow (Rapid, the default): live view -> snap -> the shot is saved on the phone at once and the camera stays ready,
// with the last shots below (a dot says waiting / sent) and Undo for the latest. Switch to Review to check every shot
// (Retake / Use Photo) before it is kept. It runs until the person taps DONE. Works on iPhone Safari, the home-screen
// app, and Chrome on Android.
//
// Props: open, onClose, uploader (the job's shared photo uploader). Pick a folder first (none is chosen
// when it opens); each accepted photo is saved on the phone and uploaded in the background while the camera stays open.
// The room chip (rooms: [{ value, label }]) stays set from shot to shot; the phone's location at the shutter is saved
// with each photo when the person allows it.
// Optional: fixedKind puts every photo in that folder and hides the folder picker (an update being
// written has no folder choice); onUploaded(rows) is called with the saved photo rows after each upload.
// For an "after" photo: ghostUrl shows the "before" faintly over the live view to line the shot up, pairOf links the new
// photo to it, and closeAfterOne closes the camera after one shot.

const MAX_DIGITAL_ZOOM = 5;
const ZOOM_PRESETS = [0.5, 1, 2, 5];
let lastStopAt = 0; // module level: lets a re-open wait for the old stream to release

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function permissionState() {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const res = await navigator.permissions.query({ name: 'camera' });
    return res.state; // granted | prompt | denied
  } catch { return 'unknown'; }
}

async function openStream(facingMode) {
  const attempts = [
    { video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
    { video: { facingMode }, audio: false },
    { video: true, audio: false },
  ];
  let lastErr;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
      // Only a constraint problem is worth trying a simpler request for.
      if (err?.name !== 'OverconstrainedError' && err?.name !== 'NotFoundError' && err?.name !== 'TypeError') throw err;
    }
  }
  throw lastErr;
}

const FOLDER_OPTIONS = PHOTO_KIND_KEYS.map((k) => ({ value: k, label: PHOTO_KINDS[k] }));

export default function CameraCapture({
  open, onClose, uploader, fixedKind = null, onUploaded = null, jobId = null,
  rooms = [], defaultRoom = '', ghostUrl = null, pairOf = null, closeAfterOne = false,
  over = false, // opened from inside a full-screen record (the inspection): show at the top level, above it, not clipped inside it
}) {
  const [kind, setKind] = useState(fixedKind);
  const [room, setRoom] = useState(defaultRoom || '');
  const [roomSheetOpen, setRoomSheetOpen] = useState(false);
  const uploadedRef = useRef(onUploaded);
  uploadedRef.current = onUploaded;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shots, setShots] = useState([]); // { id, file, kind, room, status, rowId, previewUrl }
  const shotsRef = useRef([]);
  shotsRef.current = shots;
  const queue = useRef(Promise.resolve());
  const seq = useRef(0);
  const waiting = useWaitingPhotos(jobId);
  const [rapid, setRapid] = useState(true); // Rapid: every shot is kept at once. Review: Retake / Use Photo after each.
  const gpsRef = useRef(null);
  const [gpsState, setGpsState] = useState('wait'); // wait | on | denied | none
  const destination = { options: FOLDER_OPTIONS, value: kind, setValue: setKind, sheetOpen, setSheetOpen };
  const roomOptions = [{ value: '', label: 'No room' }, ...rooms];
  const failed = shots.filter((x) => x.status === 'error').length;
  const waitingIds = new Set(waiting.map((w) => w.id));
  const shotState = (x) => {
    if (x.status === 'error') return 'failed';
    if (x.status === 'done') return 'sent';
    if (x.status === 'queued') return x.rowId && waitingIds.has(x.rowId) ? 'waiting' : 'sent';
    return 'saving';
  };
  const pending = shots.filter((x) => ['saving', 'waiting'].includes(shotState(x))).length;
  const lastShot = shots[shots.length - 1] || null;

  useEffect(() => { try { setRapid(localStorage.getItem('mj-cam-rapid') !== '0'); } catch { /* storage blocked */ } }, []);
  function toggleRapid() {
    const next = !rapid;
    setRapid(next);
    try { localStorage.setItem('mj-cam-rapid', next ? '1' : '0'); } catch { /* storage blocked */ }
    setNotice(next ? 'Rapid: every shot is kept as soon as you take it.' : 'Review: check each shot before it is kept.');
  }

  // one at a time, in the order taken, so a burst of shots does not overload the phone or connection
  function enqueue(shot) {
    queue.current = queue.current.then(async () => {
      const target = splitRoomValue(shot.room);
      const rows = await uploader.upload([shot.file], {
        kind: shot.kind,
        sketchId: target ? target.sketchId : null,
        roomKey: target ? target.roomKey : null,
        gps: shot.gps,
        pairOf,
        onItem: (_f, status, payload) => setShots((list) => list.map((x) => (x.id === shot.id ? { ...x, status, rowId: payload?.id || x.rowId } : x))),
      });
      if (rows?.length) uploadedRef.current?.(rows);
    }).catch(() => {});
  }
  function onPhotoAccepted(file, gps = null) {
    const shot = { id: ++seq.current, file, kind, room, status: 'saving', gps: gps || freshGps(gpsRef.current), rowId: null, previewUrl: URL.createObjectURL(file) };
    setShots((list) => [...list, shot]);
    enqueue(shot);
    return shot;
  }
  function retryAll() {
    shots.filter((x) => x.status === 'error').forEach((x) => {
      setShots((list) => list.map((y) => (y.id === x.id ? { ...y, status: 'saving' } : y)));
      enqueue(x);
    });
  }
  async function undoLast() {
    const shot = lastShot;
    if (!shot || !shot.rowId || undoing) return;
    setUndoing(true);
    const r = await uploader.undo(shot.rowId);
    setUndoing(false);
    if (r === 'failed') { setNotice('Could not undo that shot. Open the photo to archive it.'); return; }
    if (shot.previewUrl) URL.revokeObjectURL(shot.previewUrl);
    setShots((list) => list.filter((x) => x.id !== shot.id));
    setCount((c) => Math.max(0, c - 1));
    setNotice(r === 'removed' ? 'Shot undone.' : 'Shot undone (it had already been sent, so it is archived).');
  }
  const [undoing, setUndoing] = useState(false);
  useEffect(() => {
    if (!open) return;
    shotsRef.current.forEach((x) => x.previewUrl && URL.revokeObjectURL(x.previewUrl));
    setKind(fixedKind); setRoom(defaultRoom || ''); setShots([]); setSheetOpen(!fixedKind); setRoomSheetOpen(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => shotsRef.current.forEach((x) => x.previewUrl && URL.revokeObjectURL(x.previewUrl)), []);

  // Where the phone is, kept fresh while the camera is open, so each photo can carry the place it was taken.
  useEffect(() => {
    if (!open) return undefined;
    gpsRef.current = null;
    if (!navigator.geolocation) { setGpsState('none'); return undefined; }
    setGpsState('wait');
    let id = null;
    try {
      id = navigator.geolocation.watchPosition(
        (pos) => { const f = gpsFromPosition(pos); if (f) { gpsRef.current = f; setGpsState('on'); } },
        (err) => { if (err && err.code === 1) setGpsState('denied'); },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 },
      );
    } catch { setGpsState('none'); }
    return () => { try { if (id != null) navigator.geolocation.clearWatch(id); } catch { /* done */ } };
  }, [open]);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const fallbackInputRef = useRef(null);
  const genRef = useRef(0); // lets a slow start notice it was superseded
  const snappingRef = useRef(false);

  const [facingMode, setFacingMode] = useState('environment');
  const [markupOpen, setMarkupOpen] = useState(false);
  const [reviewFile, setReviewFile] = useState(null); // { blob, previewUrl, takenAt }
  const [count, setCount] = useState(0);
  const [error, setError] = useState(null); // { kind, message }
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState('');

  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [zoomRange, setZoomRange] = useState({ min: 1, max: MAX_DIGITAL_ZOOM, hardware: false });
  const zoomRef = useRef(1);
  const rangeRef = useRef(zoomRange);
  rangeRef.current = zoomRange;

  const stopStream = useCallback(() => {
    genRef.current += 1;
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } });
      streamRef.current = null;
      lastStopAt = Date.now();
    }
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch { /* ignore */ }
      videoRef.current.srcObject = null;
    }
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const startStream = useCallback(async () => {
    const gen = ++genRef.current;
    setError(null);
    setStarting(true);

    // iOS needs a moment after the previous stream is stopped before the
    // camera can be opened again. Opening too soon is what made re-entering
    // the camera report "access denied" even though access was granted.
    const sinceStop = Date.now() - lastStopAt;
    if (sinceStop < 400) await sleep(400 - sinceStop);

    let stream = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 3 && !stream; attempt++) {
      if (gen !== genRef.current) return; // closed or restarted meanwhile
      try {
        stream = await openStream(facingMode);
      } catch (err) {
        lastErr = err;
        const retryable = ['NotAllowedError', 'NotReadableError', 'AbortError'].includes(err?.name);
        if (!retryable) break;
        await sleep(600 * (attempt + 1));
      }
    }

    if (gen !== genRef.current) {
      // We were superseded while waiting: release whatever we got.
      stream?.getTracks().forEach(t => t.stop());
      return;
    }

    if (!stream) {
      setStarting(false);
      const name = lastErr?.name;
      if (name === 'NotAllowedError') {
        const state = await permissionState();
        if (gen !== genRef.current) return;
        if (state === 'denied') {
          setError({
            kind: 'denied',
            message: 'Camera access is turned off for this site. Turn it on in your browser or phone settings, then tap Try again.',
          });
        } else {
          setError({
            kind: 'retry',
            message: "The camera didn't start. This can happen right after leaving it. Tap Try again.",
          });
        }
      } else if (name === 'NotReadableError' || name === 'AbortError') {
        setError({ kind: 'retry', message: 'The camera is busy. Close any other app using it, then tap Try again.' });
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setError({ kind: 'none', message: 'No camera was found on this device.' });
      } else {
        setError({ kind: 'retry', message: 'Could not start the camera. Tap Try again, or choose photos from your library.' });
      }
      return;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      try { await video.play(); } catch { /* autoplay handled by playsInline + muted */ }
    }
    if (gen !== genRef.current) return;

    const track = stream.getVideoTracks()[0];
    const caps = track?.getCapabilities ? track.getCapabilities() : {};
    setTorchSupported(!!caps.torch);
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      const min = caps.zoom.min || 1;
      const max = Math.min(caps.zoom.max, 10);
      setZoomRange({ min, max, hardware: true });
      // Always open at 1x. Phones with an ultra-wide lens report a minimum of 0.5, and the bar used to start
      // there (highlighting .5) while the picture was really at 1x. Set the real zoom to match.
      const start = Math.min(max, Math.max(min, 1));
      zoomRef.current = start;
      setZoom(start);
      track.applyConstraints({ advanced: [{ zoom: start }] }).catch(() => {});
    } else {
      setZoomRange({ min: 1, max: MAX_DIGITAL_ZOOM, hardware: false });
      zoomRef.current = 1;
      setZoom(1);
    }
    setStarting(false);
  }, [facingMode]);

  // Start when opened, release when closed. The camera is also released when
  // the page is hidden (switching apps) and reopened when it comes back.
  useEffect(() => {
    if (!open) return undefined;
    setCount(0);
    setReviewFile(null);
    setNotice('');
    startStream();
    const onVisibility = () => {
      if (document.hidden) stopStream();
      else startStream();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facingMode]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Zoom ────────────────────────────────────────────────────────────────
  const applyZoom = useCallback(value => {
    const { min, max, hardware } = rangeRef.current;
    const v = Math.min(max, Math.max(min, value));
    zoomRef.current = v;
    setZoom(v);
    if (hardware) {
      const track = streamRef.current?.getVideoTracks()[0];
      track?.applyConstraints({ advanced: [{ zoom: v }] }).catch(() => {});
    }
  }, []);

  const sliderRef = useRef(null);
  function sliderToZoom(clientY) {
    const rect = sliderRef.current.getBoundingClientRect();
    const ratio = 1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const { min, max } = rangeRef.current;
    return min + ratio * (max - min);
  }
  function onSliderDown(e) {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    applyZoom(sliderToZoom(e.clientY));
  }
  function onSliderMove(e) {
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    applyZoom(sliderToZoom(e.clientY));
  }

  // Pinch to zoom on the picture.
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  function onViewportDown(e) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoomRef.current };
    }
  }
  function onViewportMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0) applyZoom(pinch.current.zoom * (dist / pinch.current.dist));
    }
  }
  function onViewportUp(e) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  // ── Capture ─────────────────────────────────────────────────────────────
  function handleSnap() {
    if (snappingRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) {
      setNotice("That shot didn't register. The camera wasn't ready. Try again.");
      return;
    }
    snappingRef.current = true;
    setNotice('');
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const digital = !rangeRef.current.hardware && zoomRef.current > 1.01;
    const z = digital ? zoomRef.current : 1;
    const sw = Math.round(vw / z);
    const sh = Math.round(vh / z);
    const sx = Math.round((vw - sw) / 2);
    const sy = Math.round((vh - sh) / 2);
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    const takenAt = Date.now();
    canvas.toBlob(
      blob => {
        snappingRef.current = false;
        if (!blob) {
          setNotice("That shot didn't come through. Try again.");
          return;
        }
        const gps = freshGps(gpsRef.current);
        if (rapid && !error) {
          const file = new File([blob], `${takenAt}-camera.jpg`, { type: 'image/jpeg' });
          onPhotoAccepted(file, gps);
          setCount((c) => c + 1);
          if (closeAfterOne) setTimeout(() => handleDone(), 350);
          return;
        }
        setReviewFile({ blob, previewUrl: URL.createObjectURL(blob), takenAt, gps });
      },
      'image/jpeg',
      0.95
    );
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setNotice("Couldn't switch the flashlight on this device.");
    }
  }

  function dropReview() {
    if (reviewFile?.previewUrl) URL.revokeObjectURL(reviewFile.previewUrl);
    setReviewFile(null);
    setMarkupOpen(false);
  }

  // Markup on the shot before it is kept: the marked up picture replaces the shot, and Use Photo then
  // saves it like any other photo.
  async function saveReviewMarkup(blob) {
    if (!blob) { setMarkupOpen(false); return; }
    setReviewFile(prev => {
      if (!prev) return prev;
      if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return { ...prev, blob, previewUrl: URL.createObjectURL(blob), marked: true };
    });
    setMarkupOpen(false);
  }

  function handleUsePhoto() {
    if (!reviewFile) return;
    const file = new File([reviewFile.blob], `${reviewFile.takenAt}-camera.jpg`, { type: 'image/jpeg' });
    onPhotoAccepted(file, reviewFile.gps);
    setCount(c => c + 1);
    dropReview();
    if (closeAfterOne) setTimeout(() => handleDone(), 350);
  }

  function handleDone() {
    stopStream();
    dropReview();
    setNotice('');
    onClose?.();
  }

  function handleFallbackFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    if (!kind) { setSheetOpen(true); return; }
    files.forEach(f => onPhotoAccepted(f));
    setCount(c => c + files.length);
  }

  if (!open) return null;

  const showFlash = torchSupported && !reviewFile;
  const zoomRatio = zoomRange.max > zoomRange.min ? (zoom - zoomRange.min) / (zoomRange.max - zoomRange.min) : 0;
  const digitalScale = !zoomRange.hardware && zoom > 1 ? zoom : 1;

  const shell = (
    <div className={`camera-overlay${over ? ' camera-over' : ''}`}>
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {!reviewFile && (
        <div className="camera-topbar">
          <div className="camera-count" aria-live="polite">
            {count} {count === 1 ? 'photo' : 'photos'}
          </div>
          <div className="camera-title">
            {gpsState === 'on' ? 'Location on' : gpsState === 'denied' ? 'Location off' : gpsState === 'wait' ? 'Finding location' : 'Photos'}
          </div>
          <div className="camera-top-actions">
            <button
              type="button"
              className={`camera-mode-btn${rapid ? '' : ' is-on'}`}
              onClick={toggleRapid}
              aria-pressed={!rapid}
              aria-label={rapid ? 'Rapid mode: every shot is kept at once. Tap to review each shot instead.' : 'Review mode: check each shot. Tap for rapid mode.'}
            >
              {rapid ? 'Rapid' : 'Review'}
            </button>
            {showFlash && (
              <button
                type="button"
                className={`camera-round-btn${torchOn ? ' is-on' : ''}`}
                onClick={toggleTorch}
                aria-label={torchOn ? 'Turn flashlight off' : 'Turn flashlight on'}
                aria-pressed={torchOn}
              >
                {torchOn ? <FlashOnIcon size={22} /> : <FlashOffIcon size={22} />}
              </button>
            )}
            <button
              type="button"
              className="camera-round-btn"
              onClick={() => setFacingMode(m => (m === 'environment' ? 'user' : 'environment'))}
              aria-label="Flip camera"
            >
              <FlipCameraIcon size={22} />
            </button>
          </div>
        </div>
      )}

      <div
        className="camera-viewport"
        onPointerDown={reviewFile ? undefined : onViewportDown}
        onPointerMove={reviewFile ? undefined : onViewportMove}
        onPointerUp={reviewFile ? undefined : onViewportUp}
        onPointerCancel={reviewFile ? undefined : onViewportUp}
      >
        <video
          ref={videoRef}
          className="camera-video"
          autoPlay
          playsInline
          muted
          style={{
            display: reviewFile ? 'none' : undefined,
            transform: digitalScale > 1 ? `scale(${digitalScale})` : undefined,
          }}
        />
        {ghostUrl && !reviewFile && !error && <img src={ghostUrl} alt="" className="camera-ghost" />}
        {starting && !error && !reviewFile && <div className="camera-status">Starting camera</div>}
        {error && !reviewFile && (
          <div className="camera-error">
            <p>{error.message}</p>
            <div className="camera-error-actions">
              {error.kind !== 'none' && (
                <button type="button" className="camera-pill-btn camera-pill-solid" onClick={startStream}>Try again</button>
              )}
              <button type="button" className="camera-pill-btn" onClick={() => fallbackInputRef.current?.click()}>
                Choose from library
              </button>
            </div>
          </div>
        )}
        {reviewFile && <img src={reviewFile.previewUrl} alt="Captured preview" className="camera-review-image" />}
        {reviewFile && (
          <button type="button" className="camera-review-markup" onClick={() => setMarkupOpen(true)}>
            <EditIcon size={18} /> Markup
          </button>
        )}

        {!reviewFile && !error && (
          <div className="camera-zoom" aria-label="Zoom">
            <div className="camera-zoom-readout">{zoom.toFixed(1)}x</div>
            <div
              ref={sliderRef}
              className="camera-zoom-track"
              onPointerDown={onSliderDown}
              onPointerMove={onSliderMove}
              role="slider"
              aria-orientation="vertical"
              aria-valuemin={zoomRange.min}
              aria-valuemax={zoomRange.max}
              aria-valuenow={Number(zoom.toFixed(1))}
              tabIndex={0}
            >
              <div className="camera-zoom-fill" style={{ height: `${zoomRatio * 100}%` }} />
              <div className="camera-zoom-thumb" style={{ bottom: `calc(${zoomRatio * 100}% - 11px)` }} />
            </div>
            <div className="camera-zoom-presets">
              {ZOOM_PRESETS.filter(v => v >= zoomRange.min - 0.01 && v <= zoomRange.max + 0.01).map(v => (
                <button
                  key={v}
                  type="button"
                  className={`camera-zoom-preset${Math.abs(zoom - v) < 0.06 ? ' is-active' : ''}`}
                  onClick={() => applyZoom(v)}
                  aria-label={`Zoom ${v}x`}
                >
                  {v}x
                </button>
              ))}
            </div>
          </div>
        )}

        {!reviewFile && !error && (
          <div className="camera-chips">
            {!fixedKind && <FolderPicker destination={destination} />}
            {rooms.length > 0 && <RoomPill options={roomOptions} value={room} onPick={setRoom} open={roomSheetOpen} setOpen={setRoomSheetOpen} />}
          </div>
        )}

        {!reviewFile && (notice || failed > 0) && (
          <div className="camera-notice" role="status">
            {notice ? notice : (
              <>
                {failed} {failed === 1 ? 'photo' : 'photos'} NOT saved.{' '}
                <button type="button" className="camera-link" onClick={retryAll}>Retry</button>
              </>
            )}
          </div>
        )}
      </div>

      {!reviewFile && (
        <div className="camera-controls">
          <div className="camera-controls-left">
            {shots.length > 0 && (
              <div className="camera-strip" aria-label="Photos taken this session">
                <div className="camera-strip-row">
                  {shots.slice(-3).map((x) => (
                    <span key={x.id} className="camera-strip-item">
                      <img src={x.previewUrl} alt="" />
                      <span className={`camera-dot is-${shotState(x)}`} title={{ saving: 'Saving on this phone', waiting: 'Saved on this phone, waiting to upload', sent: 'Uploaded', failed: 'Not saved' }[shotState(x)]} />
                    </span>
                  ))}
                </div>
                <div className="camera-strip-meta">
                  {pending > 0 ? `${pending} waiting` : 'All sent'}
                  {' '}
                  <button type="button" className="camera-link camera-undo" onClick={undoLast} disabled={!lastShot?.rowId || undoing} aria-label="Undo the last photo">
                    <UndoIcon size={14} /> Undo
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            className="camera-shutter-btn"
            onClick={handleSnap}
            disabled={!!error || starting || !kind}
            aria-label={kind ? 'Take photo' : 'Choose a folder first, then take the photo'}
          />
          <div className="camera-controls-right">
            <button type="button" className="camera-done-btn" onClick={handleDone}>DONE</button>
          </div>
        </div>
      )}

      {reviewFile && (
        <div className="camera-review-controls">
          <button type="button" className="camera-review-btn camera-review-retake" onClick={dropReview}>Retake</button>
          <button type="button" className="camera-review-btn camera-review-use" onClick={handleUsePhoto}>Use Photo</button>
        </div>
      )}

      {reviewFile && markupOpen && (
        <PhotoMarkupEditor
          imageUrl={reviewFile.previewUrl}
          onSave={saveReviewMarkup}
          onClose={() => setMarkupOpen(false)}
          saveLabel="Done"
          cancelLabel="Cancel"
          maxDimension={1920}
          onTop
        />
      )}

      <input
        ref={fallbackInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFallbackFiles}
        style={{ display: 'none' }}
      />
    </div>
  );
  return over && typeof document !== 'undefined' ? createPortal(shell, document.body) : shell;
}
