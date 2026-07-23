(function () {
  // =============================================================
  // Configuration Supabase (base de données du suivi de livraison)
  // -------------------------------------------------------------
  // La clé ci-dessous est la clé PUBLIQUE (publishable / anon).
  // Elle est faite pour être visible côté navigateur : la sécurité
  // est assurée par les règles RLS de Supabase (voir sql/supabase-setup.sql).
  // NE JAMAIS mettre ici la chaîne "postgresql://...:MOT_DE_PASSE@..."
  // =============================================================
  const SUPABASE_URL = "https://mqaxjswqchyjgtqlcwxw.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_EtM2Tfnx9MHftKx-2PjIcw_wz-tcroy";

  // Position de la pizzeria (point de départ affiché sur la carte).
  const PIZZERIA = {
    name: "Pizza'Man St Jean",
    address: "8 Route Nationale 115, 66490 Saint-Jean-Pla-de-Corts",
    lat: 42.5155,
    lng: 2.7683,
  };

  let client = null;

  function getClient() {
    if (client) return client;
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("La librairie Supabase n'a pas pu être chargée. Vérifie ta connexion internet.");
    }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    return client;
  }

  // URL absolue de la page de suivi client pour une livraison donnée.
  function trackingUrl(id) {
    const url = new URL("suivi.html", window.location.href);
    url.search = "?id=" + encodeURIComponent(id);
    return url.href;
  }

  // Lien Google Maps vers une position (s'ouvre dans l'appli Maps sur mobile).
  function googleMapsUrl(lat, lng) {
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }

  // Lien d'itinéraire Google Maps (navigation) vers une destination.
  // `destination` peut être "lat,lng" ou une adresse texte.
  function googleMapsDirectionsUrl(destination) {
    return (
      "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" +
      encodeURIComponent(destination)
    );
  }

  // Crée une nouvelle livraison et renvoie la ligne créée (avec son id).
  async function createDelivery(payload) {
    const sb = getClient();
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from("deliveries")
      .insert({
        client_name: payload.clientName || null,
        client_phone: payload.clientPhone || null,
        destination: payload.destination || null,
        eta_minutes: payload.etaMinutes || null,
        status: "en_route",
        driver_lat: payload.lat ?? null,
        driver_lng: payload.lng ?? null,
        dest_lat: payload.destLat ?? null,
        dest_lng: payload.destLng ?? null,
        started_at: now,
        updated_at: now,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Met à jour la position GPS du livreur.
  async function updatePosition(id, lat, lng) {
    const sb = getClient();
    const { error } = await sb
      .from("deliveries")
      .update({ driver_lat: lat, driver_lng: lng, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }

  // Change le statut (arrived / cancelled / en_route), avec champs optionnels.
  async function setStatus(id, status, extra) {
    const sb = getClient();
    const { error } = await sb
      .from("deliveries")
      .update(Object.assign({ status, updated_at: new Date().toISOString() }, extra || {}))
      .eq("id", id);
    if (error) throw error;
  }

  // Récupère une livraison par son id (null si introuvable).
  async function getDelivery(id) {
    const sb = getClient();
    const { data, error } = await sb.from("deliveries").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  // Abonnement temps réel aux changements d'une livraison.
  // Renvoie une fonction pour se désabonner. Si le Realtime n'est pas
  // activé, la page de suivi retombe sur un rafraîchissement périodique.
  function subscribe(id, onChange) {
    const sb = getClient();
    const channel = sb
      .channel("delivery-" + id)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "deliveries", filter: "id=eq." + id },
        (payload) => onChange(payload.new),
      )
      .subscribe();
    return function unsubscribe() {
      sb.removeChannel(channel);
    };
  }

  // Normalise un numéro FR : "06 46 57 63 69" -> "33646576369"
  function normalizePhone(raw) {
    let digits = String(raw || "").replace(/[^\d+]/g, "");
    if (!digits) return "";
    if (digits.charAt(0) === "+") digits = digits.slice(1);
    if (digits.charAt(0) === "0") digits = "33" + digits.slice(1);
    return digits;
  }

  // Distance à vol d'oiseau entre deux points (mètres).
  function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  // Transforme une adresse en coordonnées via Nominatim (OpenStreetMap, gratuit,
  // sans clé). Renvoie { lat, lng } ou null si introuvable.
  async function geocodeAddress(address) {
    const query = String(address || "").trim();
    if (!query) return null;
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fr&q=" +
      encodeURIComponent(query);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Geocode " + res.status);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  }

  // Itinéraire routier via OSRM (gratuit, sans clé). Renvoie durée (s),
  // distance (m) et le tracé [ [lat,lng], ... ]. Lève si indisponible.
  async function fetchRoute(from, to) {
    const url =
      "https://router.project-osrm.org/route/v1/driving/" +
      `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("OSRM " + res.status);
    const data = await res.json();
    if (!data.routes || !data.routes.length) throw new Error("Aucun itinéraire");
    const route = data.routes[0];
    return {
      durationSec: route.duration,
      distanceM: route.distance,
      coords: route.geometry.coordinates.map((c) => [c[1], c[0]]),
    };
  }

  window.PizzaTracking = {
    PIZZERIA,
    trackingUrl,
    googleMapsUrl,
    googleMapsDirectionsUrl,
    createDelivery,
    updatePosition,
    setStatus,
    getDelivery,
    subscribe,
    normalizePhone,
    haversineMeters,
    geocodeAddress,
    fetchRoute,
  };
})();
