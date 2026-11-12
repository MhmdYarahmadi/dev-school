/* Dev School service worker: keeps a copy of the whole site so every course opens offline.
 * Built by offline/plugin.ts, which fills in the version and the file list. */
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `zs-${VERSION}`;
/** Course sections with their own index.html (the admin dashboard is online only). */
const SECTIONS = ['pg', 'docker', 'design', 'git', 'python'];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    // Bypass the HTTP cache so the pages match this version's files.
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('zs-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks for this when the learner clicks "Reload" on the update banner.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

/** The cached page for a URL: its course section's index.html, or the home page. */
function pageFor(url) {
  const section = url.pathname.split('/').filter(Boolean)[0];
  return SECTIONS.includes(section) ? `/${section}/` : '/';
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (r) => (clearTimeout(t), resolve(r)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Accounts, progress and the admin dashboard always go to the server.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;

  if (req.mode === 'navigate') {
    // Pages: the network when it answers quickly (to pick up new versions), else the saved copy.
    event.respondWith(
      withTimeout(fetch(req), NETWORK_TIMEOUT_MS).catch(() =>
        caches.match(pageFor(url), { cacheName: CACHE }).then((r) => r ?? caches.match(pageFor(url))).then((r) => r ?? Response.error()),
      ),
    );
    return;
  }

  // Files: hashed and never changed, so the saved copy is always right; anything new is saved too.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok && url.pathname.startsWith('/assets/')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
