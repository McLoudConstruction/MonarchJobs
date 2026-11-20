'use client';

import { useEffect, useRef, useState } from 'react';
import { VOICE_MAX_SECS, VOICE_MAX_BYTES, pickVoiceFormat, durationText, voiceSeconds } from '@/lib/chat';

// Record a voice note in the chat. Tap the microphone, talk, tap Send (or Cancel). It stops by itself at the limit.
// `onRecorded({ blob, ext, type, secs })` is called with the finished recording; the chat uploads and posts it.
// Renders nothing where the phone or browser cannot record.

const MicIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" />
  </svg>
);

export default function VoiceRecorder({ disabled = false, onRecorded, onError }) {
  const [canRecord, setCanRecord] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef(null);       // the MediaRecorder
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startRef = useRef(0);
  const sendRef = useRef(false);     // true: deliver the recording when it stops; false: throw it away
  const fmtRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    setCanRecord(typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder === 'function'
      && !!pickVoiceFormat((m) => window.MediaRecorder.isTypeSupported(m)));
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanup() {
    clearInterval(timerRef.current); timerRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
    streamRef.current = null;
    recRef.current = null;
  }

  async function start() {
    if (recording || disabled) return;
    const fmt = pickVoiceFormat((m) => window.MediaRecorder.isTypeSupported(m));
    if (!fmt) { onError?.('This phone cannot record voice notes.'); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      onError?.(e?.name === 'NotAllowedError' ? 'Allow the microphone for this site to record a voice note.' : 'Could not start the microphone.');
      return;
    }
    streamRef.current = stream;
    fmtRef.current = fmt;
    chunksRef.current = [];
    sendRef.current = false;
    let rec;
    try { rec = new window.MediaRecorder(stream, { mimeType: fmt.mime }); } catch { cleanup(); onError?.('Could not start recording.'); return; }
    recRef.current = rec;
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const ms = Date.now() - startRef.current;
      const deliver = sendRef.current;
      const parts = chunksRef.current;
      cleanup();
      setRecording(false); setElapsed(0);
      if (!deliver) return;
      const secs = voiceSeconds(ms);
      if (secs == null) { onError?.('That was too short. Hold on a little longer.'); return; }
      const blob = new Blob(parts, { type: fmt.type });
      if (blob.size > VOICE_MAX_BYTES) { onError?.('That recording is too large to send.'); return; }
      onRecorded?.({ blob, ext: fmt.ext, type: fmt.type, secs });
    };
    startRef.current = Date.now();
    rec.start();
    setRecording(true); setElapsed(0);
    timerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - startRef.current) / 1000);
      setElapsed(s);
      if (s >= VOICE_MAX_SECS) finish(true);
    }, 250);
  }

  function finish(send) {
    sendRef.current = send;
    try { if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop(); else { cleanup(); setRecording(false); } } catch { cleanup(); setRecording(false); }
  }

  if (!canRecord) return null;
  if (!recording) {
    return (
      <button type="button" className="secondary chat-quick-photo" aria-label="Record a voice note" title="Record a voice note" disabled={disabled} onClick={start}>
        <MicIcon />
      </button>
    );
  }
  return (
    <div className="chat-recording" role="group" aria-label="Recording a voice note">
      <span className="chat-rec-dot" aria-hidden="true" />
      <span className="chat-rec-time">{durationText(elapsed)} / {durationText(VOICE_MAX_SECS)}</span>
      <button type="button" className="secondary" onClick={() => finish(false)}>Cancel</button>
      <button type="button" className="send" onClick={() => finish(true)}>Send</button>
    </div>
  );
}
