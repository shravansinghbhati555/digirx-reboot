/**
 * Service worker — ticket B3.
 *
 * Keeps the app shell loadable with no network, so a device that goes offline
 * mid-shift can still be reloaded (or opened from the home screen) instead of
 * showing the browser's dinosaur.
 *
 * ## Why this is hand-written
 *
 * Vite's build emits content-hashed asset names that a static worker cannot
 * know ahead of time, and the usual answer — a build plugin that injects a
 * precache manifest — is not available here. So this caches on demand
 * instead: whatever the app actually loads gets kept, and the next cold start
 * is served from it.
 *
 * ## What it deliberately does NOT do
 *
 * It never caches `/api` traffic or anything cross-origin. Clinical data is
 * cached in IndexedDB by the offline layer, which is clinic-scoped, tracks
 * freshness and can be cleared on a tenant switch. A second, invisible copy
 * sitting in the HTTP cache would have none of those properties and would
 * outlive a logout.
 */

const VERSION = 'v3';
const SHELL_CACHE = `digirx-shell-${VERSION}`;

const PRECACHE = ['/', '/index.html', '/favicon.svg', '/icons.svg', '/manifest.webmanifest'];

/**
 * Cache the shell *and* the hashed bundles it references.
 *
 * Without this second step the worker only starts controlling pages after the
 * first load has already fetched its JS and CSS — so those assets never enter
 * the cache, and the first offline reload dies on a missing bundle even
 * though `index.html` was cached. The app appeared to need loading twice
 * before it survived going offline.
 *
 * Reading the asset URLs out of `index.html` gets us the content-hashed names
 * that are not knowable when this file is written.
 */
async function precacheShell(cache) {
  await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
  try {
    const res = await fetch('/index.html', { cache: 'reload' });
    if (!res.ok) return;
    const html = await res.clone().text();
    await cache.put('/index.html', res);

    const urls = new Set();
    const re = /(?:src|href)=["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const u = m[1];
      if (u.startsWith('/') && /\.(js|css|woff2?|svg)$/.test(u)) urls.add(u);
    }
    await Promise.allSettled([...urls].map((u) => cache.add(u)));
  } catch {
    // Offline at install time, or index.html unreadable. The worker still
    // installs; it simply has less cached.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => precacheShell(cache))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Cache lookups ignore `Vary`. Servers commonly send `Vary: Origin` on static
 * files, and Vite's `<script type="module" crossorigin>` makes the page send
 * an `Origin` header the install-time precache did not — so a Vary-respecting
 * match missed every bundle, and the offline reload rendered a blank page.
 * Safe here: bundles are content-hashed, so one URL is one body.
 */
const MATCH = { ignoreVary: true };

/** Same-origin static assets we are willing to hold. */
function isShellAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api')) return false;
  return /\.(js|css|woff2?|ttf|svg|png|jpg|jpeg|webp|ico|json|webmanifest)$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // The API is never served from here. Offline reads go through IndexedDB,
  // where they are clinic-scoped and have a freshness stamp.
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network so a deploy is picked up, fall back to the
  // cached shell. The SPA router takes over from there.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() =>
          caches
            .match('/index.html', MATCH)
            .then((cached) => cached ?? new Response('Offline', { status: 503 })),
        ),
    );
    return;
  }

  if (!isShellAsset(url)) return;

  // Assets are content-hashed, so a cache hit is always correct for that URL.
  // Serve it immediately and refresh in the background.
  event.respondWith(
    caches.match(req, MATCH).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});

// Lets the app trigger an immediate update after a deploy.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
