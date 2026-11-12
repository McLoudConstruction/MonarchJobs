// Pure helpers for Web Push, kept free of browser and server imports so they can be tested.

// The public key arrives as base64url text; the browser wants bytes.
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

// iPadOS reports as a Mac but has touch points.
export function isIosDevice(ua, maxTouchPoints = 0) {
  return /iPad|iPhone|iPod/.test(ua || '') || (/Macintosh/.test(ua || '') && maxTouchPoints > 1);
}

// What the "Enable notifications" control should show.
//   unconfigured  the site has no VAPID key yet
//   needs_install iPhone/iPad Safari tab: add to Home Screen first
//   unsupported   this browser cannot do push
//   denied        the person said no in the browser's permission prompt
//   off           can be turned on now
//   on            this device is subscribed
export function pushStatus({ configured, supported, ios, standalone, permission, subscribed }) {
  if (!configured) return 'unconfigured';
  if (ios && !standalone) return 'needs_install';
  if (!supported) return 'unsupported';
  if (permission === 'denied') return 'denied';
  if (permission === 'granted' && subscribed) return 'on';
  return 'off';
}

// What the phone shows. Kept short: the lock screen is public.
export function buildPayload(n) {
  return {
    id: n.id,
    title: n.title,
    body: n.body || '',
    url: n.url || '/dashboard',
    // the same notification updated in place keeps its tag, so it replaces instead of stacking
    tag: n.dedupe_key || `n-${n.id}`,
  };
}

// 404 / 410 mean the phone removed the subscription; anything else is a passing problem.
export function isGoneStatus(status) {
  return status === 404 || status === 410;
}
