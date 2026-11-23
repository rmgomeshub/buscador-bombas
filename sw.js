// Buscador de Bombas — atualização de cache da identidade visual Obracon
const CACHE = 'bombas-pwa-v3-obracon';
const FILES = [
  './', './index.html', './style.css', './app.js', './config.js',
  './manifest.webmanifest', './catalogo-inicial.json',
  './icons/icon-192.png', './icons/icon-512.png'
];
const LOGOS = ['./obracon-logo-branca.webp', './obracon-logo.webp'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES);
    // Não impede a atualização do app se uma imagem ainda estiver propagando no Pages.
    await Promise.allSettled(LOGOS.map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('bombas-pwa-') && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      // Busca a versão mais recente quando há internet.
      const fresh = await fetch(request);
      if (fresh.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, fresh.clone());
      }
      return fresh;
    } catch (error) {
      const saved = await caches.match(request, {ignoreSearch: true});
      if (saved) return saved;
      if (request.mode === 'navigate') {
        const home = await caches.match('./index.html');
        if (home) return home;
      }
      return Response.error();
    }
  })());
});
