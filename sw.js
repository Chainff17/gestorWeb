// sw.js - Service Worker (v2.0)
// - Estáticos: cache-first con actualización en segundo plano
// - Navegaciones: network-first con fallback offline
// - Supabase (API/datos): SIEMPRE red — nunca cachear respuestas de datos
const CACHE_NAME = 'gestor-pagos-v3.12';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json?v=4',
  './offline.html',
  './icon-app-192.png',
  './icon-app-512.png',
  './icon-apple-180.png',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.6.2/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache =>
        // allSettled: un CDN caído no debe bloquear la instalación
        Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url)))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function esSupabase(url) {
  return url.hostname.endsWith('.supabase.co');
}

function esEstatico(url) {
  return url.hostname.includes('cdnjs.cloudflare.com') ||
         url.hostname.includes('cdn.jsdelivr.net') ||
         url.hostname.includes('fonts.googleapis.com') ||
         url.hostname.includes('fonts.gstatic.com');
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return; // no tocar POST/PUT (auth, upserts)

  const url = new URL(request.url);

  // 1) Supabase: siempre red (los datos nunca deben quedar obsoletos en caché)
  if (esSupabase(url)) {
    event.respondWith(fetch(request));
    return;
  }

  // 2) Navegaciones: red primero, caché de la app, luego offline.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)).catch(() => {});
          return response;
        })
        .catch(() =>
          caches.match('./index.html').then(r => r || caches.match('./offline.html'))
        )
    );
    return;
  }

  // 3) Estáticos (app + CDN): cache primero, red como respaldo (y se actualiza en 2º plano)
  if (esEstatico(url) || url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) {
          // actualización en segundo plano (stale-while-revalidate)
          fetch(request)
            .then(response => {
              if (response && response.status === 200) {
                const copy = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
              }
            })
            .catch(() => {});
          return cached;
        }
        return fetch(request).then(response => {
          if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        });
      })
    );
  }
  // resto (otros orígenes no listados): dejar que el navegador lo maneje
});
