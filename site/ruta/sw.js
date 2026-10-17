// Funciona sin señal: la aplicación queda guardada en el teléfono después de la primera visita.
const CACHE = 'predix-ruta-v2';
const SHELL = ['./', 'index.html', 'ruta.css', 'app.js', 'model.js', 'data.js', 'worker.js', 'icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Red primero para tener la última versión; caché si no hay señal.
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone();
    if (res.ok || res.type === 'opaque') caches.open(CACHE).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html'))));
});
