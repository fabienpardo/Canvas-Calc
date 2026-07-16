const ASSET_REVISION = '3b8e68be3878';
const CACHE_PREFIX = 'canvas-calc-';
const CACHE = CACHE_PREFIX + ASSET_REVISION;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './sw-register.js',
  './app.js',
  './state.js',
  './engine.js',
  './sidebar.js',
  './render.js',
  './interactions.js',
  './canvases.js',
  './editing.js',
  './input.js',
  './history.js',
  './store.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

function isHttpRequest(req) {
  const protocol = new URL(req.url).protocol;
  return protocol === 'http:' || protocol === 'https:';
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Bypass the HTTP cache: a new revision must precache the bytes actually
      // on the server, not whatever stale copies the browser cached earlier —
      // otherwise the new cache is poisoned with old assets under a new name.
      return c.addAll(ASSETS.map(function (a) { return new Request(a, { cache: 'reload' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (!isHttpRequest(req)) return;

  // Navigations / HTML: keep the document on the same cached revision as its
  // CSS and JavaScript. The browser's service-worker update check installs the
  // next complete shell, and sw-register.js reloads once that worker takes
  // control. This avoids rendering new HTML with old cache-first assets.
  const isNav = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').indexOf('text/html') !== -1;
  if (isNav) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(req, { ignoreSearch: true }).then(function (hit) {
          if (hit) return hit;
          return c.match('./index.html').then(function (shell) {
            if (shell) return shell;
            return fetch(req).then(function (res) {
              if (res && res.ok) c.put(req, res.clone());
              return res;
            });
          });
        });
      })
    );
    return;
  }

  // Static assets: cache-first (with runtime fill).
  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && res.ok) {
            c.put(req, res.clone());
          }
          return res;
        });
      });
    })
  );
});
