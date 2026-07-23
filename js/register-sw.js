/* Enregistre le service worker (mise à jour automatique du site).
   Le mode « réseau d'abord » du service worker garantit du contenu frais
   à chaque visite ; ici on force juste la vérification des mises à jour et
   on recharge une fois quand une nouvelle version prend le contrôle. */
(function () {
  if (!("serviceWorker" in navigator)) return;

  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Pas de rechargement à la toute première installation.
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => reg.update())
      .catch(() => {
        /* enregistrement impossible (ex: ouvert en local) : on ignore */
      });
  });
})();
