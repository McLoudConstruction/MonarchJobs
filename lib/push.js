// Browser side of Web Push: is it available on this device, turn it on, turn it off.
// The server key is the public VAPID key from NEXT_PUBLIC_VAPID_PUBLIC_KEY (the private half stays
// on the server). Permission must be asked from a tap, once per device.

import { apiFetch } from '@/lib/useAuth';
import { urlBase64ToUint8Array, isIosDevice, pushStatus } from '@/lib/pushState';

export function isIos() {
  if (typeof navigator === 'undefined') return false;
  return isIosDevice(navigator.userAgent, navigator.maxTouchPoints);
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function pushConfigured() {
  return !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
}

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready);
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

export async function readPushStatus() {
  const supported = pushSupported();
  const sub = supported ? await currentSubscription() : null;
  return pushStatus({
    configured: pushConfigured(),
    supported,
    ios: isIos(),
    standalone: isStandalone(),
    permission: supported ? Notification.permission : 'default',
    subscribed: !!sub,
  });
}

function toBody(sub) {
  const json = sub.toJSON();
  return { endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent };
}

// Must be called from a tap. Returns the new status, or throws with a readable message.
export async function enablePush(token) {
  if (!pushConfigured()) throw new Error('Push is not set up on this site yet.');
  if (!pushSupported()) throw new Error('This browser cannot receive push notifications.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed. You can change this in your browser or phone settings.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    });
  }
  await apiFetch('/api/push/subscription', token, { method: 'POST', body: JSON.stringify(toBody(sub)) });
  return 'on';
}

export async function disablePush(token) {
  const sub = await currentSubscription();
  if (!sub) return 'off';
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* already gone */ }
  try { await apiFetch('/api/push/subscription', token, { method: 'DELETE', body: JSON.stringify({ endpoint }) }); } catch { /* the server cleans up dead ones on the next send */ }
  return 'off';
}

// On every app load: if this device already has permission, keep the service worker current and
// make sure the server knows the (possibly renewed) subscription.
export async function resyncPush(token) {
  if (!pushConfigured() || !pushSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) await apiFetch('/api/push/subscription', token, { method: 'POST', body: JSON.stringify(toBody(sub)) });
  } catch { /* best effort */ }
}
