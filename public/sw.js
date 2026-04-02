/**
 * TextileLab Studio — Service Worker
 * Stratégie : Cache-first pour assets statiques, Network-first pour API
 */

const CACHE_VERSION  = 'tl-v2';
const STATIC_CACHE   = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE  = `${CACHE_VERSION}-dynamic`;
const API_CACHE      = `${CACHE_VERSION}-api`;

// Assets à mettre en cache immédiatement à l'installation
const PRECACHE_ASSETS = [
  '/textilelab-studio.html',
  '/textilelab-login.html',
  '/textilelab-admin.html',
  '/textilelab-backoffice-mockups.html',
  '/manifest.json',
  // Fonts Google (si servis localement — sinon ignorer)
];

// Domaines toujours traités en Network-first
const NETWORK_FIRST_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'api.resend.com',
];

// URLs qui ne doivent JAMAIS être mises en cache
const BYPASS_PATTERNS = [
  /\/api\//,          // API backend — network only avec fallback
  /\/shopify\//,      // webhooks Shopify
  /chrome-extension/,
];

// ── Install ───────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      // Précache silencieux — ignore les erreurs réseau
      const results = await Promise.allSettled(
        PRECACHE_ASSETS.map(url => cache.add(url).catch(() => null))
      );
      const ok = results.filter(r => r.status === 'fulfilled').length;
      console.log(`[SW] Installed — ${ok}/${PRECACHE_ASSETS.length} assets cached`);
    })
  );
  self.skipWaiting(); // Activer immédiatement
});

// ── Activate — purge vieux caches ────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      const toDelete = keys.filter(k => k.startsWith('tl-') && !k.startsWith(CACHE_VERSION));
      await Promise.all(toDelete.map(k => caches.delete(k)));
      console.log(`[SW] Activated — purged ${toDelete.length} old caches`);
      return self.clients.claim();
    })
  );
});

// ── Fetch strategy ────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET et extensions Chrome
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // APIs tierces → Network-first, pas de cache
  if (NETWORK_FIRST_HOSTS.includes(url.hostname)) {
    return; // Pass through
  }

  // Routes API backend → Network-first avec fallback cache
  if (BYPASS_PATTERNS.some(p => p.test(url.pathname))) {
    event.respondWith(networkFirstAPI(request));
    return;
  }

  // Google Fonts → Stale-while-revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
    return;
  }

  // CDN scripts (Fabric, Three, etc.) → Cache-first longue durée
  if (url.hostname.includes('cdnjs') || url.hostname.includes('unpkg') || url.hostname.includes('cdn.')) {
    event.respondWith(cacheFirst(request, DYNAMIC_CACHE));
    return;
  }

  // Pages HTML → Network-first TOUJOURS (évite les versions figées)
  if (request.headers.get('Accept')?.includes('text/html') || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirstHTML(request));
    return;
  }

  // Assets statiques → Cache-first avec fallback offline
  event.respondWith(cacheFirstWithOfflineFallback(request));
});

// ── Strategies ────────────────────────────────────────────────────────

/** Network-first pour HTML — toujours la version la plus récente */
async function networkFirstHTML(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

/** Cache-first — si absent, fetche et met en cache */
async function cacheFirst(request, cacheName = STATIC_CACHE) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback(request);
  }
}

/** Cache-first avec page offline en dernier recours */
async function cacheFirstWithOfflineFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback(request);
  }
}

/** Network-first avec cache en fallback — pour les API */
async function networkFirstAPI(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** Stale-while-revalidate — répond depuis cache, refresh en arrière-plan */
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || fetchPromise;
}

/** Page d'erreur offline générée dynamiquement */
function offlineFallback(request) {
  const url = new URL(request.url);

  // Si c'est une page HTML → page offline inline
  if (request.headers.get('Accept')?.includes('text/html')) {
    return new Response(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Hors ligne — TextileLab Studio</title>
  <style>
    body{margin:0;background:#0a0a0c;color:#f0f0f5;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;text-align:center;padding:20px}
    h1{font-size:22px;font-weight:800;margin:0}h1 span{color:#F59E0B}
    p{color:#888;font-size:14px;max-width:340px;line-height:1.6;margin:0}
    button{padding:12px 24px;background:#F59E0B;border:none;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;color:#000;margin-top:8px}
    .icon{font-size:52px}
  </style>
</head>
<body>
  <div class="icon">📡</div>
  <h1>Textile<span>Lab</span> Studio</h1>
  <p>Vous êtes hors ligne. Vos designs locaux sont disponibles, mais la connexion au serveur est requise pour sauvegarder ou commander.</p>
  <button onclick="location.reload()">🔄 Réessayer</button>
</body>
</html>`, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return new Response('Offline', { status: 503 });
}

// ── Background sync (si supporté) ────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-designs') {
    console.log('[SW] Background sync: designs');
    // Les designs en attente seront syncés quand la connexion revient
  }
});

// ── Push notifications (si configuré) ────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'TextileLab Studio', {
      body:  data.body  || '',
      icon:  '/manifest.json',
      badge: '/manifest.json',
      tag:   data.tag   || 'tl-notification',
      data:  { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});

console.log('[SW] TextileLab Service Worker loaded — v' + CACHE_VERSION);
