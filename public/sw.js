// MonarchJobs service worker: Web Push, and keeping the app itself on the phone so it opens with no signal.
// Data is NOT cached here (the app keeps its own copy of jobs and pictures waiting to upload in IndexedDB); this only
// keeps the app's code and page shells. Anything under /api/ and anything on another site is never touched.

const STATIC = 'mj-static-v2';
const PAGES = 'mj-pages-v2';
const KEEP = [STATIC, PAGES];
const MAX_PAGES = 80;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('mj-') && !KEEP.includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));

// ------------------------------------------------------------------ offline cache
const sameOrigin = (url) => url.origin === self.location.origin;

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_PAGES; i += 1) await cache.delete(keys[i]);
}

// Hashed build files never change: serve from the phone, fetch once.
async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

// Pages: try the network briefly, fall back to the last copy. A page copy is saved after every good load.
async function networkFirst(request, key) {
  const cache = await caches.open(PAGES);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 6000)),
    ]);
    if (res.ok && res.type !== 'opaqueredirect') { cache.put(key, res.clone()); trim(cache); }
    return res;
  } catch (e) {
    const hit = await cache.match(key, { ignoreVary: true });
    if (hit) return hit;
    throw e;
  }
}

const OFFLINE_HTML = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<body style="font-family:-apple-system,Segoe UI,sans-serif;max-width:420px;margin:12vh auto;padding:0 20px;color:#1c2430">
<h2>You are offline</h2>
<p>This page was not opened on this phone before, so it is not saved here. Anything you already took is safe and will upload when you have signal.</p>
<p><a href="/queue">See pictures waiting to upload</a></p>
<p><a href="/dashboard">Back to the app</a></p></body>`;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!sameOrigin(url)) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;

  if (url.pathname.startsWith('/_next/static/')) { event.respondWith(cacheFirst(req)); return; }

  const isRsc = req.headers.get('RSC') === '1' || url.searchParams.has('_rsc');
  if (req.mode === 'navigate' || isRsc) {
    // pages are saved by their path, so ?query strings do not make separate copies; page data (RSC) by its full address
    const key = req.mode === 'navigate' ? new Request(url.origin + url.pathname) : req;
    event.respondWith(networkFirst(req, key).catch(async () => {
      if (req.mode !== 'navigate') return Response.error();
      const cache = await caches.open(PAGES);
      return (await cache.match(new Request(url.origin + '/queue'))) || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }));
    return;
  }

  // other same-site files (icons, fonts): the saved copy first, refreshed in the background
  if (/\.(png|jpg|jpeg|svg|webp|ico|woff2?|css|js|webmanifest)$/.test(url.pathname) || url.pathname === '/manifest.json') {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
  }
});

// Lets the app ask for a page to be kept (used to get today's jobs ready before leaving a place with signal).
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'warm' && Array.isArray(d.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(PAGES);
      for (const u of d.urls) {
        try {
          const url = new URL(u, self.location.origin);
          if (!sameOrigin(url)) continue;
          const res = await fetch(url.href, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
          if (res.ok) await cache.put(new Request(url.origin + url.pathname), res);
        } catch { /* skip this one */ }
      }
    })());
  }
});

// ------------------------------------------------------------------ push
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
