/* Service worker Sirko web app — aplikasi tetap bisa dibuka tanpa internet.
 *
 * - Navigasi /app, /app/* : jaringan dulu (dapat versi terbaru), gagal → index.html tersimpan.
 * - Aset /app/assets : simpan sekali, pakai dari cache (nama file ber-hash → tak pernah basi).
 * - API /v1/*        : TIDAK pernah di-cache (data ada di IndexedDB, sync yang mengurus).
 */
const CACHE = 'sirko-app-v2';
const SHELL = ['/app/', '/app/manifest.webmanifest', '/app/icon.svg'];

// Pasang: simpan kerangka + SEMUA aset build (daftar dari assets.json) → setiap halaman bisa dibuka offline.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(async (c) => {
        await c.addAll(SHELL);
        const list = await fetch('/app/assets.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
        await c.addAll(list);
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || (url.pathname !== '/app' && !url.pathname.startsWith('/app/'))) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put('/app/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/app/').then((r) => r || new Response('Sirko offline: buka sekali saat online dulu.', { status: 503 }))),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.startsWith('/app/assets/') || SHELL.includes(url.pathname))) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
