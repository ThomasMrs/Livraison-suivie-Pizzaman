(function () {
  const STORAGE_KEY = "pizzaman_active_delivery";
  const PUSH_INTERVAL_MS = 3000; // n'envoie pas la position plus d'une fois toutes les 3 s

  const form = document.querySelector("#delivery-form");
  const startButton = document.querySelector("#start-button");
  const feedback = document.querySelector("#driver-feedback");
  const livePanel = document.querySelector("#live-panel");
  const liveTitle = document.querySelector("#live-title");
  const positionStatus = document.querySelector("#position-status");
  const messageBox = document.querySelector("#client-message");
  const sendSms = document.querySelector("#send-sms");
  const previewLink = document.querySelector("#preview-link");
  const routeLink = document.querySelector("#route-link");
  const arrivedButton = document.querySelector("#arrived-button");
  const cancelButton = document.querySelector("#cancel-button");
  const driverMapEl = document.querySelector("#driver-map");

  const ROUTE_THROTTLE_MS = 12000;

  const state = {
    deliveryId: null,
    phone: "",
    watchId: null,
    lastPushAt: 0,
    lastCoords: null,
    destCoords: null,
    map: null,
    driverMarker: null,
    destMarker: null,
    routeCasing: null,
    routeLine: null,
    lastRouteAt: 0,
    fittedRoute: false,
  };

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

  // ---------------- Carte du livreur ----------------

  function emojiIcon(emoji, className) {
    return window.L.divIcon({
      className: "map-emoji " + (className || ""),
      html: `<span>${emoji}</span>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }

  function initDriverMap(lat, lng) {
    if (state.map || !window.L || !driverMapEl) return;
    const p = PizzaTracking.PIZZERIA;
    const center = lat != null && lng != null ? [lat, lng] : [p.lat, p.lng];
    state.map = window.L.map(driverMapEl, { zoomControl: true }).setView(center, 15);
    window.L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap &copy; CARTO",
    }).addTo(state.map);
    window.L.marker([p.lat, p.lng], { icon: emojiIcon("🍕", "is-pizzeria") })
      .addTo(state.map)
      .bindPopup(p.name);
    window.setTimeout(() => {
      if (state.map) state.map.invalidateSize();
    }, 200);
  }

  function setDestMarker(pos) {
    if (!state.map || !pos) return;
    const latlng = [pos.lat, pos.lng];
    if (!state.destMarker) {
      state.destMarker = window.L.marker(latlng, { icon: emojiIcon("🏠", "is-dest") })
        .addTo(state.map)
        .bindPopup("Client");
    } else {
      state.destMarker.setLatLng(latlng);
    }
  }

  function drawRoute(coords) {
    if (!state.map || !coords || coords.length < 2) return;
    if (!state.routeCasing) {
      state.routeCasing = window.L.polyline(coords, {
        color: "#ffffff",
        weight: 9,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(state.map);
      state.routeLine = window.L.polyline(coords, {
        color: "#0e5b3f",
        weight: 5,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(state.map);
    } else {
      state.routeCasing.setLatLngs(coords);
      state.routeLine.setLatLngs(coords);
    }
    if (!state.fittedRoute && state.destCoords && state.lastCoords) {
      state.map.fitBounds(
        window.L.latLngBounds([
          [state.lastCoords.lat, state.lastCoords.lng],
          [state.destCoords.lat, state.destCoords.lng],
        ]),
        { padding: [50, 50], maxZoom: 16 },
      );
      state.fittedRoute = true;
    }
  }

  function updateDriverMarker(lat, lng) {
    if (!state.map || lat == null || lng == null) return;
    const latlng = [lat, lng];
    if (!state.driverMarker) {
      state.driverMarker = window.L.marker(latlng, {
        icon: emojiIcon("🛵", "is-driver"),
        zIndexOffset: 1000,
      })
        .addTo(state.map)
        .bindPopup("Toi");
    } else {
      state.driverMarker.setLatLng(latlng);
    }
    if (!state.destCoords) state.map.panTo(latlng, { animate: true });
  }

  // Calcule le temps livreur -> client et met à jour l'estimation + le tracé.
  async function computeEta(from, to) {
    try {
      const r = await PizzaTracking.fetchRoute(from, to);
      return { minutes: Math.max(1, Math.round(r.durationSec / 60)), coords: r.coords };
    } catch (error) {
      const meters = PizzaTracking.haversineMeters(from, to) * 1.3;
      return {
        minutes: Math.max(1, Math.round(meters / 6.5 / 60)),
        coords: [
          [from.lat, from.lng],
          [to.lat, to.lng],
        ],
      };
    }
  }

  function maybeUpdateRoute(lat, lng, force) {
    if (!state.destCoords) return;
    const now = Date.now();
    if (!force && now - state.lastRouteAt < ROUTE_THROTTLE_MS) return;
    state.lastRouteAt = now;
    computeEta({ lat, lng }, state.destCoords).then((res) => {
      state.etaMinutes = res.minutes;
      drawRoute(res.coords);
      updateMessageLinks();
    });
  }

  function setFeedback(message, isError) {
    feedback.textContent = message || "";
    feedback.classList.toggle("is-error", Boolean(isError));
  }

  function setPositionStatus(text) {
    positionStatus.textContent = text;
  }

  function isAppleMobile() {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  function buildMessage(clientName, etaMinutes, url, coords) {
    const greeting = clientName ? `Bonjour ${clientName}, ` : "Bonjour, ";
    const lines = [`${greeting}votre commande Pizza'Man part de la pizzeria ! 🍕🛵`];
    if (etaMinutes) {
      lines.push(`J'arrive dans environ ${etaMinutes} min.`);
    }
    lines.push(`Suivi en direct : ${url}`);
    if (coords) {
      lines.push(`Google Maps : ${PizzaTracking.googleMapsUrl(coords.lat, coords.lng)}`);
    }
    return lines.join("\n");
  }

  function updateMessageLinks() {
    if (!state.deliveryId) return;
    const url = PizzaTracking.trackingUrl(state.deliveryId);
    const clientName = (state.clientName || "").trim();
    const message = buildMessage(clientName, state.etaMinutes, url, state.lastCoords);
    messageBox.value = message;

    const encoded = encodeURIComponent(message);
    const separator = isAppleMobile() ? "&" : "?";
    const smsTarget = state.phone ? "+" + state.phone : "";
    sendSms.href = `sms:${smsTarget}${separator}body=${encoded}`;

    previewLink.href = url;
    updateRouteLink();
  }

  // Lien d'itinéraire Google Maps du livreur vers l'adresse du client.
  function updateRouteLink() {
    if (!routeLink) return;
    const dest = state.destCoords
      ? `${state.destCoords.lat},${state.destCoords.lng}`
      : (state.address || "").trim();
    if (!dest) {
      routeLink.hidden = true;
      return;
    }
    routeLink.hidden = false;
    routeLink.href = PizzaTracking.googleMapsDirectionsUrl(dest);
  }

  function pushPosition(lat, lng, force) {
    state.lastCoords = { lat, lng };
    const now = Date.now();
    if (!force && now - state.lastPushAt < PUSH_INTERVAL_MS) return;
    state.lastPushAt = now;

    PizzaTracking.updatePosition(state.deliveryId, lat, lng)
      .then(() => {
        const time = new Date().toLocaleTimeString("fr-FR");
        setPositionStatus(`Position partagée ✅ (dernier envoi ${time})`);
      })
      .catch((error) => {
        setPositionStatus("Impossible d'envoyer la position. Nouvelle tentative…");
        console.error(error);
      });
  }

  function startWatching() {
    if (!("geolocation" in navigator)) {
      setPositionStatus("La géolocalisation n'est pas disponible sur cet appareil.");
      return;
    }
    if (state.watchId !== null) return;

    state.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        pushPosition(latitude, longitude, false);
        updateDriverMarker(latitude, longitude);
        maybeUpdateRoute(latitude, longitude, false);
        updateMessageLinks();
      },
      (error) => {
        console.error(error);
        if (error.code === error.PERMISSION_DENIED) {
          setPositionStatus("Position refusée. Active la localisation pour que le client te suive.");
        } else {
          setPositionStatus("Signal GPS faible, en attente d'une position…");
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
  }

  function stopWatching() {
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
  }

  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("Géolocalisation indisponible"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        (error) => reject(error),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
      );
    });
  }

  function showLivePanel() {
    form.hidden = true;
    livePanel.hidden = false;
    refreshIcons();
  }

  function persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          deliveryId: state.deliveryId,
          clientName: state.clientName,
          phone: state.phone,
          address: state.address,
          etaMinutes: state.etaMinutes,
          destCoords: state.destCoords,
        }),
      );
    } catch (error) {
      /* localStorage indisponible : on ignore */
    }
  }

  function clearPersisted() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      /* ignore */
    }
  }

  async function startDelivery(event) {
    event.preventDefault();
    setFeedback("");

    if (!form.reportValidity()) return;

    const data = new FormData(form);
    state.clientName = String(data.get("clientName") || "").trim();
    state.phone = PizzaTracking.normalizePhone(data.get("clientPhone"));
    state.etaMinutes = null;
    const destination = String(data.get("destination") || "").trim();
    state.address = destination;

    startButton.disabled = true;
    setFeedback("Récupération de ta position GPS…");

    let coords = null;
    try {
      coords = await getCurrentPosition();
    } catch (error) {
      console.error(error);
      startButton.disabled = false;
      if (error && error.code === error.PERMISSION_DENIED) {
        setFeedback("Tu dois autoriser la localisation pour partager ta position au client.", true);
      } else {
        setFeedback("Impossible d'obtenir ta position GPS. Réessaie en extérieur.", true);
      }
      return;
    }

    // Géocode l'adresse et calcule le temps d'arrivée automatiquement.
    setFeedback("Calcul de l'itinéraire vers l'adresse…");
    let routeCoords = null;
    try {
      state.destCoords = await PizzaTracking.geocodeAddress(destination);
      if (state.destCoords) {
        const eta = await computeEta(coords, state.destCoords);
        state.etaMinutes = eta.minutes;
        routeCoords = eta.coords;
      }
    } catch (error) {
      console.error(error);
      state.destCoords = null;
    }

    setFeedback("Création du suivi…");
    try {
      const delivery = await PizzaTracking.createDelivery({
        clientName: state.clientName,
        clientPhone: state.phone ? "+" + state.phone : "",
        destination,
        etaMinutes: state.etaMinutes,
        lat: coords.lat,
        lng: coords.lng,
        destLat: state.destCoords ? state.destCoords.lat : null,
        destLng: state.destCoords ? state.destCoords.lng : null,
      });
      state.deliveryId = delivery.id;
      state.lastCoords = coords;
      state.lastPushAt = Date.now();
      state.lastRouteAt = Date.now();
    } catch (error) {
      console.error(error);
      startButton.disabled = false;
      setFeedback("Erreur de connexion à la base de suivi. Vérifie ta connexion.", true);
      return;
    }

    persist();
    setFeedback("");
    showLivePanel();
    initDriverMap(coords.lat, coords.lng);
    updateDriverMarker(coords.lat, coords.lng);
    if (state.destCoords) {
      setDestMarker(state.destCoords);
      if (routeCoords) drawRoute(routeCoords);
      setPositionStatus(
        state.etaMinutes
          ? `Position partagée ✅ · arrivée estimée ~${state.etaMinutes} min`
          : "Position partagée ✅",
      );
    } else {
      setPositionStatus("Position partagée ✅ (adresse non localisée, estimation via le client)");
    }
    updateMessageLinks();
    startWatching();
  }

  async function resumeIfActive() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (error) {
      saved = null;
    }
    if (!saved || !saved.deliveryId) return;

    let delivery = null;
    try {
      delivery = await PizzaTracking.getDelivery(saved.deliveryId);
    } catch (error) {
      return;
    }

    if (!delivery || delivery.status !== "en_route") {
      clearPersisted();
      return;
    }

    state.deliveryId = delivery.id;
    state.clientName = saved.clientName || delivery.client_name || "";
    state.phone = saved.phone || "";
    state.address = delivery.destination || saved.address || "";
    state.etaMinutes = saved.etaMinutes || delivery.eta_minutes || null;
    if (delivery.driver_lat != null && delivery.driver_lng != null) {
      state.lastCoords = { lat: delivery.driver_lat, lng: delivery.driver_lng };
    }
    if (delivery.dest_lat != null && delivery.dest_lng != null) {
      state.destCoords = { lat: delivery.dest_lat, lng: delivery.dest_lng };
    } else if (saved.destCoords) {
      state.destCoords = saved.destCoords;
    }

    showLivePanel();
    const c = state.lastCoords;
    initDriverMap(c ? c.lat : null, c ? c.lng : null);
    if (c) updateDriverMarker(c.lat, c.lng);
    if (state.destCoords) {
      setDestMarker(state.destCoords);
      if (c) maybeUpdateRoute(c.lat, c.lng, true);
    }
    setPositionStatus("Reprise de la livraison en cours…");
    updateMessageLinks();
    startWatching();
  }

  async function finishDelivery(status, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    stopWatching();
    if (state.deliveryId) {
      try {
        await PizzaTracking.setStatus(state.deliveryId, status);
      } catch (error) {
        console.error(error);
      }
    }
    clearPersisted();

    if (status === "arrived") {
      liveTitle.textContent = "Livraison terminée 🎉";
      setPositionStatus("Le client a été prévenu que tu es arrivé.");
    } else {
      liveTitle.textContent = "Course annulée";
      setPositionStatus("La course a été annulée.");
    }
    livePanel.classList.add("is-finished");

    window.setTimeout(() => {
      window.location.reload();
    }, 2500);
  }

  form.addEventListener("submit", startDelivery);
  arrivedButton.addEventListener("click", () => finishDelivery("arrived"));
  cancelButton.addEventListener("click", () => finishDelivery("cancelled", "Annuler cette livraison ?"));

  refreshIcons();
  resumeIfActive();
})();
