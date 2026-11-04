/* Audiowizard Workspace — Service Worker (кеш оболочки, обновления, офлайн) */
const VER = '0.1-prototype.1236';
const CACHE = `aw-shell-${VER}`;

const PRECACHE = [
  './', './index.html', './portal.html',
  './manifest.json', './version.json',
  './css/base.css', './css/app.css',
  './js/store.js', './js/xlsx.js', './js/ui.js', './js/ai-data.js', './js/ai.js', './js/crm.js', './js/windows.js', './js/navdrag.js', './js/app.js',
  './icons/icon.svg', './icons/maskable.svg', './bg/pattern-ai.svg'
];

self.addEventListener('install', e => {
  /* толерантный precache: один битый URL не должен ломать установку SW */
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(PRECACHE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('aw-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'VERSION') {
    e.source && e.source.postMessage({ type: 'VERSION', version: VER });
  }
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Навигация: сеть с откатом в кеш/оболочку
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then(r => r || caches.match('./index.html'))
      )
    );
    return;
  }

  // Статика и версия: сеть-первым (свежая версия всегда), кэш — офлайн-фолбэк
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && !url.pathname.includes('version.json')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() =>
      caches.match(req).then(hit => hit || caches.match('./index.html'))
    )
  );
});
