/* Service worker do Controle Carros.
 * Estratégia: rede primeiro, cai pro cache quando estiver offline.
 * Assim o app sempre pega a versão mais nova quando há internet,
 * e ainda abre (mostrando o último estado carregado) quando não há. */
const CACHE = 'controle-carros-v1';
const ARQUIVOS = [
  './',
  './index.html',
  './manifest.json',
  './favicon-32.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ARQUIVOS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  // Só cuida dos arquivos do próprio site. Supabase, Google Fonts e o
  // script do supabase-js passam direto pela rede, sem interferência.
  if(url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then(resp => {
        const copia = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
