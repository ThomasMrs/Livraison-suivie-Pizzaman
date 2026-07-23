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
  const sendWhatsapp = document.querySelector("#send-whatsapp");
  const copyLink = document.querySelector("#copy-link");
  const previewLink = document.querySelector("#preview-link");
  const arrivedButton = document.querySelector("#arrived-button");
  const cancelButton = document.querySelector("#cancel-button");

  const state = {
    deliveryId: null,
    phone: "",
    watchId: null,
    lastPushAt: 0,
    lastCoords: null,
  };

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
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
    const lines = [
      `${greeting}votre commande Pizza'Man part de la pizzeria ! 🍕🛵`,
      `J'arrive dans environ ${etaMinutes} min.`,
      `Suivi en direct : ${url}`,
    ];
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

    sendWhatsapp.href = state.phone
      ? `https://wa.me/${state.phone}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;

    previewLink.href = url;
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
          etaMinutes: state.etaMinutes,
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
    state.etaMinutes = Number(data.get("etaMinutes")) || 10;
    const destination = String(data.get("destination") || "").trim();

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

    setFeedback("Création du suivi…");
    try {
      const delivery = await PizzaTracking.createDelivery({
        clientName: state.clientName,
        clientPhone: state.phone ? "+" + state.phone : "",
        destination,
        etaMinutes: state.etaMinutes,
        lat: coords.lat,
        lng: coords.lng,
      });
      state.deliveryId = delivery.id;
      state.lastCoords = coords;
      state.lastPushAt = Date.now();
    } catch (error) {
      console.error(error);
      startButton.disabled = false;
      setFeedback("Erreur de connexion à la base de suivi. Vérifie ta connexion.", true);
      return;
    }

    persist();
    setFeedback("");
    showLivePanel();
    setPositionStatus("Position partagée ✅");
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
    state.etaMinutes = saved.etaMinutes || delivery.eta_minutes || 10;
    if (delivery.driver_lat != null && delivery.driver_lng != null) {
      state.lastCoords = { lat: delivery.driver_lat, lng: delivery.driver_lng };
    }

    showLivePanel();
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

  function copyTrackingLink() {
    if (!state.deliveryId) return;
    const url = PizzaTracking.trackingUrl(state.deliveryId);
    const done = () => {
      setFeedback("Lien de suivi copié ✅");
      window.setTimeout(() => setFeedback(""), 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => window.prompt("Copie ce lien :", url));
    } else {
      window.prompt("Copie ce lien :", url);
    }
  }

  form.addEventListener("submit", startDelivery);
  arrivedButton.addEventListener("click", () => finishDelivery("arrived"));
  cancelButton.addEventListener("click", () => finishDelivery("cancelled", "Annuler cette livraison ?"));
  copyLink.addEventListener("click", copyTrackingLink);

  refreshIcons();
  resumeIfActive();
})();
