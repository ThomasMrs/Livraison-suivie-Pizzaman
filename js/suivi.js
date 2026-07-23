(function () {
  const POLL_INTERVAL_MS = 5000; // filet de sécurité si le temps réel n'est pas actif
  const TICK_INTERVAL_MS = 15000; // rafraîchit l'estimation régulièrement
  const STALE_AFTER_MS = 90000; // position du livreur "en attente" après 1 min 30
  const ROUTE_THROTTLE_MS = 8000; // ne recalcule pas l'itinéraire plus d'une fois / 8 s
  const DETOUR_FACTOR = 1.3; // à vol d'oiseau -> distance route approx. (secours)
  const AVG_SPEED_MPS = 6.5; // ~23 km/h en secours si le routage échoue

  const titleEl = document.querySelector("#tracking-title");
  const noteEl = document.querySelector("#tracking-note");
  const etaWrap = document.querySelector("#tracking-eta");
  const etaClock = document.querySelector("#eta-clock");
  const etaRemaining = document.querySelector("#eta-remaining");
  const etaDistanceBlock = document.querySelector("#eta-distance-block");
  const etaDistance = document.querySelector("#eta-distance");
  const etaSource = document.querySelector("#eta-source");
  const liveDot = document.querySelector("#live-dot");
  const mapsLink = document.querySelector("#maps-link");
  const mapEl = document.querySelector("#map");
  const geoPrompt = document.querySelector("#geo-prompt");
  const geoEnable = document.querySelector("#geo-enable");

  const state = {
    id: null,
    delivery: null,
    map: null,
    driverMarker: null,
    destMarker: null,
    pizzaMarker: null,
    routeLine: null,
    driverPos: null,
    clientPos: null,
    hasFitBounds: false,
    unsubscribe: null,
    pollTimer: null,
    tickTimer: null,
    geoWatchId: null,
    lastRouteAt: 0,
    computingRoute: false,
  };

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

  function getIdFromUrl() {
    return new URLSearchParams(window.location.search).get("id");
  }

  // ---------------- Carte ----------------

  function emojiIcon(emoji, className) {
    return window.L.divIcon({
      className: "map-emoji " + (className || ""),
      html: `<span>${emoji}</span>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }

  function initMap() {
    const pizzeria = PizzaTracking.PIZZERIA;
    state.map = window.L.map(mapEl, { zoomControl: true }).setView([pizzeria.lat, pizzeria.lng], 14);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(state.map);

    state.pizzaMarker = window.L.marker([pizzeria.lat, pizzeria.lng], {
      icon: emojiIcon("🍕", "is-pizzeria"),
      title: pizzeria.name,
    }).addTo(state.map);
    state.pizzaMarker.bindPopup(pizzeria.name);

    window.setTimeout(() => state.map.invalidateSize(), 200);
  }

  function setDriverMarker(pos) {
    const latlng = [pos.lat, pos.lng];
    if (!state.driverMarker) {
      state.driverMarker = window.L.marker(latlng, {
        icon: emojiIcon("🛵", "is-driver"),
        title: "Votre livreur",
        zIndexOffset: 1000,
      }).addTo(state.map);
      state.driverMarker.bindPopup("Votre livreur");
    } else {
      state.driverMarker.setLatLng(latlng);
    }
  }

  function setDestMarker(pos) {
    const latlng = [pos.lat, pos.lng];
    if (!state.destMarker) {
      state.destMarker = window.L.marker(latlng, {
        icon: emojiIcon("📍", "is-dest"),
        title: "Vous êtes ici",
      }).addTo(state.map);
      state.destMarker.bindPopup("Vous êtes ici");
    } else {
      state.destMarker.setLatLng(latlng);
    }
  }

  function drawRoute(coords) {
    if (!coords || coords.length < 2) return;
    if (!state.routeLine) {
      state.routeLine = window.L.polyline(coords, {
        color: "#b8322b",
        weight: 5,
        opacity: 0.85,
      }).addTo(state.map);
    } else {
      state.routeLine.setLatLngs(coords);
    }
  }

  function fitToPoints() {
    const points = [];
    if (state.driverPos) points.push([state.driverPos.lat, state.driverPos.lng]);
    if (state.clientPos) points.push([state.clientPos.lat, state.clientPos.lng]);
    if (!state.clientPos) {
      const pizzeria = PizzaTracking.PIZZERIA;
      points.push([pizzeria.lat, pizzeria.lng]);
    }
    if (points.length < 1) return;
    if (points.length === 1) {
      state.map.setView(points[0], 15);
    } else {
      state.map.fitBounds(window.L.latLngBounds(points), { padding: [55, 55], maxZoom: 16 });
    }
    state.hasFitBounds = true;
  }

  // ---------------- Distances / itinéraire ----------------

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

  // Itinéraire routier via OSRM (gratuit, sans clé). Renvoie durée, distance
  // et le tracé de la route. Lève une erreur si indisponible.
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

  function estimateStraightLine(from, to) {
    const straight = haversineMeters(from, to);
    const distanceM = straight * DETOUR_FACTOR;
    return {
      durationSec: distanceM / AVG_SPEED_MPS,
      distanceM,
      coords: [
        [from.lat, from.lng],
        [to.lat, to.lng],
      ],
    };
  }

  // ---------------- Formatage ----------------

  function formatClock(date) {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDistance(meters) {
    if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
    return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
  }

  function formatRemaining(durationSec) {
    if (durationSec <= 45) return "Arrivée imminente";
    const minutes = Math.max(1, Math.round(durationSec / 60));
    return `${minutes} min`;
  }

  // ---------------- Estimation dynamique ----------------

  async function recomputeEta(force) {
    if (!state.delivery || state.delivery.status !== "en_route") return;
    if (!state.driverPos || !state.clientPos) {
      renderFallbackEta();
      return;
    }
    const now = Date.now();
    if (!force && now - state.lastRouteAt < ROUTE_THROTTLE_MS) return;
    if (state.computingRoute) return;

    state.computingRoute = true;
    let route = null;
    try {
      route = await fetchRoute(state.driverPos, state.clientPos);
    } catch (error) {
      route = estimateStraightLine(state.driverPos, state.clientPos);
    }
    state.computingRoute = false;
    state.lastRouteAt = Date.now();

    const arrival = new Date(Date.now() + route.durationSec * 1000);
    etaWrap.hidden = false;
    etaClock.textContent = formatClock(arrival);
    etaRemaining.textContent = formatRemaining(route.durationSec);
    etaDistanceBlock.hidden = false;
    etaDistance.textContent = formatDistance(route.distanceM);
    etaSource.hidden = false;
    etaSource.textContent = "Estimation en direct selon votre position 📍";

    drawRoute(route.coords);
  }

  // Estimation de secours : durée fixe donnée par le livreur au départ.
  function renderFallbackEta() {
    const delivery = state.delivery;
    if (!delivery || delivery.status !== "en_route" || !delivery.started_at || !delivery.eta_minutes) {
      etaWrap.hidden = true;
      etaSource.hidden = true;
      return;
    }
    const arrival = new Date(delivery.started_at).getTime() + delivery.eta_minutes * 60000;
    const remainingMs = arrival - Date.now();
    etaWrap.hidden = false;
    etaClock.textContent = formatClock(new Date(arrival));
    etaRemaining.textContent = remainingMs <= 30000 ? "Arrivée imminente" : `${Math.round(remainingMs / 60000)} min`;
    etaDistanceBlock.hidden = true;
    etaSource.hidden = false;
    etaSource.textContent = "Estimation indicative du livreur — activez votre position pour l'affiner.";
  }

  // ---------------- Rendu statut ----------------

  function renderStatus() {
    const delivery = state.delivery;
    if (!delivery) return;
    const name = delivery.client_name || "";

    if (delivery.status === "arrived") {
      liveDot.classList.remove("is-live");
      titleEl.textContent = name ? `${name}, votre livreur est arrivé ! 🎉` : "Votre livreur est arrivé ! 🎉";
      noteEl.textContent = "Bon appétit 🍕";
      etaWrap.hidden = true;
      etaSource.hidden = true;
      geoPrompt.hidden = true;
      return;
    }

    if (delivery.status === "cancelled") {
      liveDot.classList.remove("is-live");
      titleEl.textContent = "Livraison annulée";
      noteEl.textContent = "Cette livraison a été annulée. Contactez la pizzeria au 06-46-57-63-69.";
      etaWrap.hidden = true;
      etaSource.hidden = true;
      geoPrompt.hidden = true;
      return;
    }

    liveDot.classList.add("is-live");
    titleEl.textContent = name ? `${name}, votre livreur est en route 🛵` : "Votre livreur est en route 🛵";

    if (!state.driverPos) {
      noteEl.textContent = "En attente de la position du livreur…";
      return;
    }

    const updatedAt = delivery.updated_at ? new Date(delivery.updated_at).getTime() : 0;
    if (Date.now() - updatedAt > STALE_AFTER_MS) {
      noteEl.textContent = "Position en cours d'actualisation…";
    } else if (delivery.destination) {
      noteEl.textContent = `En route vers : ${delivery.destination}`;
    } else {
      noteEl.textContent = "Suivez sa progression sur la carte ci-dessous.";
    }
  }

  function renderMapsLink() {
    const d = state.delivery;
    if (d && d.status === "en_route" && d.driver_lat != null && d.driver_lng != null) {
      mapsLink.hidden = false;
      mapsLink.href = PizzaTracking.googleMapsUrl(d.driver_lat, d.driver_lng);
    } else {
      mapsLink.hidden = true;
    }
  }

  function render() {
    renderStatus();
    renderMapsLink();
    if (state.driverPos) {
      setDriverMarker(state.driverPos);
      if (!state.hasFitBounds) fitToPoints();
    }
    if (state.clientPos && state.driverPos) {
      recomputeEta(false);
    } else {
      renderFallbackEta();
    }
    refreshIcons();
  }

  function applyDelivery(delivery) {
    if (!delivery) return;
    state.delivery = delivery;
    if (delivery.driver_lat != null && delivery.driver_lng != null) {
      state.driverPos = { lat: delivery.driver_lat, lng: delivery.driver_lng };
    }
    render();
    if (delivery.status !== "en_route") stopUpdates();
  }

  // ---------------- Position du client ----------------

  function onClientPosition(position) {
    const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
    const firstFix = !state.clientPos;
    const moved = firstFix || haversineMeters(state.clientPos, pos) > 25;
    state.clientPos = pos;
    setDestMarker(pos);
    geoPrompt.hidden = true;
    // Au premier point du client, on recadre pour voir livreur + client.
    if (firstFix || !state.hasFitBounds) fitToPoints();
    if (moved) recomputeEta(true);
  }

  function onClientPositionError(error) {
    if (error && error.code === error.PERMISSION_DENIED) {
      geoPrompt.hidden = false;
    }
    renderFallbackEta();
  }

  function startClientGeo() {
    if (!("geolocation" in navigator)) {
      geoPrompt.hidden = true;
      return;
    }
    if (state.geoWatchId !== null) return;
    state.geoWatchId = navigator.geolocation.watchPosition(onClientPosition, onClientPositionError, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 20000,
    });
  }

  // ---------------- Rafraîchissement ----------------

  function stopUpdates() {
    if (state.unsubscribe) {
      state.unsubscribe();
      state.unsubscribe = null;
    }
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    if (state.tickTimer) {
      window.clearInterval(state.tickTimer);
      state.tickTimer = null;
    }
    if (state.geoWatchId !== null) {
      navigator.geolocation.clearWatch(state.geoWatchId);
      state.geoWatchId = null;
    }
  }

  async function poll() {
    try {
      const delivery = await PizzaTracking.getDelivery(state.id);
      if (delivery) applyDelivery(delivery);
    } catch (error) {
      console.error(error);
    }
  }

  function showError(message) {
    titleEl.textContent = message;
    noteEl.textContent = "";
    liveDot.classList.remove("is-live");
    etaWrap.hidden = true;
    etaSource.hidden = true;
    geoPrompt.hidden = true;
    mapEl.hidden = true;
  }

  async function start() {
    state.id = getIdFromUrl();
    if (!state.id) {
      showError("Lien de suivi invalide.");
      return;
    }

    initMap();

    let delivery = null;
    try {
      delivery = await PizzaTracking.getDelivery(state.id);
    } catch (error) {
      console.error(error);
      showError("Connexion au suivi impossible. Réessaie dans un instant.");
      return;
    }

    if (!delivery) {
      showError("Livraison introuvable.");
      return;
    }

    applyDelivery(delivery);

    if (delivery.status === "en_route") {
      startClientGeo();

      try {
        state.unsubscribe = PizzaTracking.subscribe(state.id, applyDelivery);
      } catch (error) {
        console.error(error);
      }
      state.pollTimer = window.setInterval(poll, POLL_INTERVAL_MS);
      state.tickTimer = window.setInterval(() => {
        renderStatus();
        if (state.clientPos && state.driverPos) recomputeEta(false);
        else renderFallbackEta();
      }, TICK_INTERVAL_MS);
    }
  }

  geoEnable.addEventListener("click", () => {
    geoPrompt.hidden = true;
    // Nouvelle tentative dans un geste utilisateur (exigé par certains navigateurs).
    if (state.geoWatchId !== null) {
      navigator.geolocation.clearWatch(state.geoWatchId);
      state.geoWatchId = null;
    }
    startClientGeo();
  });

  window.addEventListener("beforeunload", stopUpdates);

  start();
})();
