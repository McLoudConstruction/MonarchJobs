// MonarchJobs service worker: Web Push only. It does not cache pages or work offline.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// The server sends JSON: { title, body, url, tag, id }
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'MonarchJobs', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'MonarchJobs';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || undefined,      // same tag replaces the earlier one instead of stacking
      renotify: !!data.tag,
      data: { url: data.url || '/dashboard', id: data.id || null },
    })
  );
});

// Tapping a notification opens (or focuses) the app on the right page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/dashboard', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          return w.focus().then((c) => ('navigate' in c ? c.navigate(target) : c));
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
