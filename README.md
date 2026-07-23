# Livraison suivie Pizza'Man

Petit site autonome de **suivi de livraison en temps réel** pour Pizza'Man St Jean.
Le livreur partage sa position GPS et prévient le client de son départ ; le client
suit la course sur une carte avec une estimation d'arrivée qui se recalcule toute
seule (façon Uber Eats). Aucune application à installer.

## Pages

- `index.html` : accueil, avec l'accès à l'espace livreur.
- `livreur.html` : espace livreur (partage de position + message automatique au client).
- `suivi.html` : page de suivi en direct pour le client (carte + estimation).

## Fichiers

- `js/tracking.js` : configuration Supabase + fonctions de suivi.
- `js/livreur.js` : logique de l'espace livreur (GPS, message client).
- `js/suivi.js` : logique de la carte de suivi côté client + estimation dynamique.
- `sql/supabase-setup.sql` : script à exécuter une fois dans Supabase.
- `styles.css` : styles du site.
- `assets/` : logo et favicon.

## Comment ça marche

1. **Le livreur** ouvre `livreur.html`, renseigne le nom du client, son téléphone
   et l'**adresse de livraison (obligatoire)**, puis appuie sur « Je pars ». Le
   téléphone demande l'autorisation de partager la position ; il faut l'accepter.
   Le livreur **ne saisit aucune durée** : le temps d'arrivée est calculé
   automatiquement (l'adresse est convertie en coordonnées, puis l'itinéraire
   routier livreur → adresse donne l'estimation).
2. Le livreur suit alors sa propre position et le trajet sur une **carte intégrée**
   et prévient le client **en un clic** via le bouton « Prévenir le client (SMS) »
   (WhatsApp et copie du lien restent disponibles). Le message contient l'estimation
   calculée, un **lien de suivi en direct** et un lien Google Maps.
3. **Le client** ouvre le lien reçu (`suivi.html?id=...`) et voit le livreur se
   déplacer sur la carte, avec l'heure d'arrivée qui se recalcule en continu. S'il
   active sa position, l'estimation se fait vers son emplacement exact ; sinon elle
   se fait vers l'adresse de livraison.
4. À l'arrivée, le livreur appuie sur « Je suis arrivé » (ou « Annuler »).

La position se rafraîchit via Supabase Realtime, avec un rafraîchissement
périodique (toutes les 5 s) en filet de sécurité. La carte utilise Leaflet, le
fond CARTO Voyager, le routage OSRM et le géocodage Nominatim (tous gratuits et
sans clé d'API).

## Configuration Supabase (à faire une fois)

1. Dans le tableau de bord Supabase, ouvrir `SQL Editor`, coller le contenu de
   `sql/supabase-setup.sql` et cliquer sur `Run`. Cela crée la table `deliveries`,
   active la sécurité (RLS) et le temps réel. **Le script est ré-exécutable** : si
   la table existait déjà, il ajoute les colonnes manquantes (`dest_lat`,
   `dest_lng`). Re-lancez-le après cette mise à jour.
2. Vérifier que l'URL et la clé publique dans `js/tracking.js` correspondent au
   projet (`Settings` -> `API` -> `Project URL` et `anon`/`publishable key`).

> La clé utilisée dans `js/tracking.js` est la clé **publique** (publishable) :
> elle est conçue pour être visible dans le navigateur. Ne jamais y mettre le mot
> de passe de la base ni la chaîne `postgresql://...`.

> Ce site partage la même base Supabase que le site de commande principal : une
> seule exécution du script SQL suffit pour les deux.

## Estimation d'arrivée automatique

Personne ne saisit de durée. L'estimation est calculée par GPS et se met à jour
toute seule :

- l'adresse de livraison est géocodée en coordonnées (Nominatim) ;
- l'itinéraire routier livreur → destination (OSRM) donne le temps et le tracé ;
- le calcul se refait à chaque déplacement du livreur (limité à 1 fois / 8–12 s).

Côté client, la destination est **sa position exacte** s'il active sa
géolocalisation, sinon **l'adresse de livraison**. Dans les deux cas l'estimation
s'actualise en direct. Si le routage échoue, une estimation « à vol d'oiseau »
prend le relais. La position du client n'est **pas enregistrée** : ce calcul reste
dans son navigateur.

## Ajouter à l'écran d'accueil (icône du raccourci)

Le site est installable : sur mobile, « Ajouter à l'écran d'accueil » crée un
raccourci avec le logo Pizza'Man et l'ouvre en plein écran (sans barre du
navigateur). C'est géré par `manifest.json` et les icônes de `assets/`
(`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`).

## Mise à jour automatique (plus besoin de vider le cache)

Un service worker (`sw.js`) fonctionne en mode **« réseau d'abord »** : à chaque
visite, il récupère la version fraîche des fichiers sur le réseau (le cache ne
sert qu'au mode hors-ligne). Le site est donc toujours à jour sans vider le cache.

Après un déploiement, incrémente la constante `VERSION` en haut de `sw.js`
(ex. `2026-07-23-1` -> `2026-07-23-2`) : les anciens caches sont alors purgés et,
si l'appli est ouverte, elle se recharge une fois pour appliquer la nouvelle
version.

## Publier sur GitHub Pages

`Settings` -> `Pages`, puis sélectionner la branche `main` et le dossier racine.
La géolocalisation exige HTTPS : elle fonctionne sur GitHub Pages, mais pas en
ouvrant les fichiers en local (`file://`). Pour tester en local, lancer un petit
serveur, par exemple `python -m http.server`.

## Note de sécurité

Le site n'a pas de compte livreur : quiconque connaît l'URL de `livreur.html` peut
créer une livraison. Comme le lien de suivi contient un identifiant impossible à
deviner, ce compromis est acceptable pour un usage de proximité. Pour durcir,
ajouter une authentification livreur (Supabase Auth) et restreindre les règles
`insert`/`update` du script SQL.
