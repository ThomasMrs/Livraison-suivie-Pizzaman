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

  window.PizzaTracking = {
    PIZZERIA,
    trackingUrl,
    googleMapsUrl,
    createDelivery,
    updatePosition,
    setStatus,
    getDelivery,
    subscribe,
    normalizePhone,
  };
})();
