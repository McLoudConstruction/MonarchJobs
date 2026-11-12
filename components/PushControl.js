'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/useAuth';
import { readPushStatus, enablePush, disablePush } from '@/lib/push';

// "Turn on notifications on this phone". Permission has to be asked from a tap, once per device,
// so this is a button rather than something that happens on load.
export default function PushControl({ token }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  useEffect(() => { readPushStatus().then(setStatus); }, []);

  async function turnOn() {
    setBusy(true); setMsg(null);
    try { setStatus(await enablePush(token)); setMsg({ ok: true, text: 'Notifications are on for this device.' }); }
    catch (e) { setMsg({ ok: false, text: e.message }); setStatus(await readPushStatus()); }
    setBusy(false);
  }

  async function turnOff() {
    setBusy(true); setMsg(null);
    setStatus(await disablePush(token));
    setBusy(false);
  }

  async function sendTest() {
    setBusy(true); setMsg(null);
    try { await apiFetch('/api/push/test', token, { method: 'POST', body: '{}' }); setMsg({ ok: true, text: 'Test sent. It should arrive in a few seconds.' }); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  }

  if (!status) return null;

  return (
    <div className="card push-card">
      <h3>Push notifications on this device</h3>
      {status === 'on' && (
        <>
          <p className="hint">On. You will get a notification here even when the app is closed.</p>
          <div className="row">
            <button type="button" className="secondary small" disabled={busy} onClick={sendTest}>Send me a test</button>
            <button type="button" className="secondary small" disabled={busy} onClick={turnOff}>Turn off on this device</button>
          </div>
        </>
      )}
      {status === 'off' && (
        <>
          <p className="hint">Get new leads, schedule changes and job updates as they happen, even when the app is closed. Each phone and each browser is turned on once.</p>
          <button type="button" className="primary" disabled={busy} onClick={turnOn}>{busy ? 'Turning on...' : 'Turn on notifications'}</button>
        </>
      )}
      {status === 'needs_install' && (
        <p className="hint">On iPhone and iPad, add MonarchJobs to your Home Screen first: tap the Share button in Safari, choose <strong>Add to Home Screen</strong>, then open MonarchJobs from the new icon and come back to this page.</p>
      )}
      {status === 'denied' && (
        <p className="hint">Notifications are blocked for this site on this device. Allow them in your browser or phone settings (in Chrome, the lock icon next to the address) for MonarchJobs, then come back and turn them on.</p>
      )}
      {status === 'unsupported' && (
        <p className="hint">This browser cannot receive push notifications. The bell inside the app still works.</p>
      )}
      {status === 'unconfigured' && (
        <p className="hint">Push is not set up on this site yet (the server keys are missing). The bell inside the app still works.</p>
      )}
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
    </div>
  );
}
