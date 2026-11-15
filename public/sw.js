// Invenstory service worker: app-shell cache and Web Push.
// Pushes carry no data; the worker reads the latest event from the API (view=notice).
// Shares the IndexedDB store with src/lib/kv.ts (db "invenstory", store "kv", key "api").

const SHELL = 'invenstory-shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Network first so deploys show up; the cached shell keeps the app opening offline.
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(SHELL).then((c) => c.put('/', copy));
          return r;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Hashed build assets never change.
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((r) => {
            if (r.ok) {
              const copy = r.clone();
              caches.open(SHELL).then((c) => c.put(req, copy));
            }
            return r;
          }),
      ),
    );
  }
});

function readKv(key) {
  return new Promise((resolve) => {
    const open = indexedDB.open('invenstory', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => resolve(undefined);
    open.onsuccess = () => {
      try {
        const req = open.result.transaction('kv', 'readonly').objectStore('kv').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    };
  });
}

async function latestNotice() {
  const api = await readKv('api');
  if (!api || !api.url) return null;
  try {
    const u = new URL(api.url);
    u.searchParams.set('view', 'notice');
    const r = await fetch(u, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

self.addEventListener('push', (e) => {
  e.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const focused = windows.find((w) => w.focused && w.visibilityState === 'visible');
      if (focused) {
        // The app is in front: refresh it instead of notifying.
        focused.postMessage({ type: 'push' });
        return;
      }
      for (const w of windows) w.postMessage({ type: 'push' });
      const n = await latestNotice();
      const failure = n && n.kind === 'failure';
      await self.registration.showNotification((n && n.title) || 'Invenstory', {
        body: (n && n.body) || 'Something changed.',
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: failure ? 'invenstory-failure' : 'invenstory-items',
        renotify: true,
        data: { kind: n && n.kind },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const w = windows[0];
      if (w) {
        await w.focus();
        w.postMessage({ type: 'push' });
      } else {
        await self.clients.openWindow('/');
      }
    })(),
  );
});
