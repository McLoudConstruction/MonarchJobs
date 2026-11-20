'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { prepareImage } from '@/lib/photoUpload';

// "Scan meter": photograph the meter screen, the AI the owner connected reads the numbers, and they fill the reading sheet.
// Nothing is saved here: the tech checks the numbers and taps Save. The picture is shrunk and not kept (add a Meter photo from
// the reading's history if the photo should stay on file). Renders nothing until we know scanning is set up.

let readyCache = null; // { at, ready }: asked once every few minutes, not every time a sheet opens
const READY_MS = 5 * 60 * 1000;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('The picture could not be read.'));
    r.readAsDataURL(blob);
  });
}

const UNIT_TEXT = { percent: '%MC', wme: '%WME', relative: 'on the relative scale', unknown: '' };

// What was read, in one short line, so the tech can compare it with the meter in their hand.
export function meterSummary(res) {
  const bits = [];
  if (res.moisture != null) bits.push(`reading ${res.moisture}${UNIT_TEXT[res.unit] ? ` ${UNIT_TEXT[res.unit]}` : ''}`);
  if (res.rh != null) bits.push(`RH ${res.rh}%`);
  if (res.tempF != null) bits.push(`${res.tempF}°F`);
  return bits.join(', ');
}

export default function MeterScan({ onResult, wantsMoisture = true }) {
  const input = useRef(null);
  const [ready, setReady] = useState(readyCache && Date.now() - readyCache.at < READY_MS ? readyCache.ready : null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function token() { return (await getSupabase().auth.getSession()).data?.session?.access_token; }

  useEffect(() => {
    if (ready !== null) return undefined;
    let live = true;
    (async () => {
      let ok = false;
      try { const r = await apiFetch('/api/ai/usage', await token()); ok = !!r.ready; } catch { ok = false; }
      readyCache = { at: Date.now(), ready: ok };
      if (live) setReady(ok);
    })();
    return () => { live = false; };
  }, [ready]);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('No signal. Type the reading in, or scan when you are back online.');
      const { fullBlob } = await prepareImage(file);
      const image = await blobToBase64(fullBlob);
      const r = await apiFetch('/api/ai/extract', await token(), { method: 'POST', body: JSON.stringify({ kind: 'meter', media_type: 'image/jpeg', image }) });
      const res = r.result;
      const found = meterSummary(res);
      if (found) onResult(res);
      const warn = (res.warnings || []).join(' ');
      setMsg(found
        ? { warn: !!warn, text: `Read from the meter: ${found}. Check it against the screen, then save.${warn ? ` ${warn}` : ''}` }
        : { err: true, text: warn || 'No numbers were found. Type the reading in.' });
    } catch (err) {
      setMsg({ err: true, text: err.message || 'The scan did not work. Type the reading in.' });
    }
    setBusy(false);
  }

  if (!ready) return null;
  return (
    <div className="sk-meterscan">
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={pick} aria-label="Photo of the meter screen" />
      <button type="button" className="secondary small" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Reading the meter...' : (wantsMoisture ? 'Scan meter' : 'Scan humidity meter')}
      </button>
      {msg && <div className={`msg${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'} style={{ margin: '6px 0 0' }}>{msg.text}</div>}
    </div>
  );
}
