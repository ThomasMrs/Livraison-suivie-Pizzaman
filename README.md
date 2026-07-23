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
   et la durée estimée, puis appuie sur « Je pars ». Le téléphone demande
   l'autorisation de partager la position ; il faut l'accepter.
2. Le site crée la livraison dans la base et génère un **message prêt à envoyer**
   (SMS ou WhatsApp) contenant la durée estimée, un **lien de suivi en direct** et
   un lien Google Maps.
3. **Le client** ouvre le lien reçu (`suivi.html?id=...`) et voit le livreur se
   déplacer sur la carte. S'il active sa position, l'heure d'arrivée est recalculée
   en continu selon l'itinéraire routier réel livreur → client.
4. À l'arrivée, le livreur appuie sur « Je suis arrivé » (ou « Annuler »).

La position se rafraîchit via Supabase Realtime, avec un rafraîchissement
périodique (toutes les 5 s) en filet de sécurité. La carte utilise Leaflet +
OpenStreetMap et le routage OSRM (gratuits, sans clé d'API).

## Configuration Supabase (à faire une fois)

1. Dans le tableau de bord Supabase, ouvrir `SQL Editor`, coller le contenu de
   `sql/supabase-setup.sql` et cliquer sur `Run`. Cela crée la table `deliveries`,
   active la sécurité (RLS) et le temps réel.
2. Vérifier que l'URL et la clé publique dans `js/tracking.js` correspondent au
   projet (`Settings` -> `API` -> `Project URL` et `anon`/`publishable key`).

> La clé utilisée dans `js/tracking.js` est la clé **publique** (publishable) :
> elle est conçue pour être visible dans le navigateur. Ne jamais y mettre le mot
> de passe de la base ni la chaîne `postgresql://...`.

> Ce site partage la même base Supabase que le site de commande principal : une
> seule exécution du script SQL suffit pour les deux.

## Estimation d'arrivée dynamique

Sur la page de suivi, le client peut **activer sa position**. L'estimation est
alors recalculée en continu :

- itinéraire routier réel entre le livreur et le client via OSRM
  (`router.project-osrm.org`) ;
- tracé de la route affiché sur la carte + distance restante ;
- recalcul à chaque déplacement du livreur (limité à 1 fois / 8 s).

Si le routage échoue, une estimation « à vol d'oiseau » prend le relais. Si le
client refuse la géolocalisation, l'estimation retombe sur la durée fixe saisie
par le livreur. La position du client n'est **pas enregistrée** : le calcul reste
dans son navigateur.

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
