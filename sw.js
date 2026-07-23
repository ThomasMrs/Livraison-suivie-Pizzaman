/* =============================================================
   Service worker Pizza'Man Livraison
   -------------------------------------------------------------
   Stratégie « réseau d'abord » : à chaque visite, on va chercher
   la version fraîche des fichiers sur le réseau. Le cache ne sert
   que de secours hors-ligne. Résultat : plus besoin de vider le
   cache pour voir les mises à jour du site.
   ============================================================= */

// Change ce numéro à chaque déploiement pour purger l'ancien cache.
const VERSION = "2026-07-23-3";
const CACHE = "pm-livraison-" + VERSION;

// Installe immédiatement la nouvelle version (ne pas attendre).
self.addEventListener("install", () => {
  self.skipWaiting();
});

// Active tout de suite et supprime les anciens caches.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // On ne touche qu'à nos propres fichiers : les tuiles de carte, OSRM,
  // Nominatim, Supabase et les CDN passent normalement (pas d'interception).
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirst(req));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    // no-store force le navigateur à ignorer son cache HTTP => toujours frais.
    const fresh = await fetch(request, { cache: "no-store" });
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (error) {
    // Hors-ligne : on sert la dernière version connue si disponible.
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const home = await cache.match("index.html");
      if (home) return home;
    }
    return Response.error();
  }
}
