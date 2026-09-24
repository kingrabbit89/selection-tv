# Architecture de Sélection TV

## Principe

Les numéros hebdomadaires ne doivent plus contenir leur propre CSS ou JavaScript.

Chaque URL de semaine conserve un `semaines/YYYY-Sxx/index.html` très léger. Ce fichier ne fait qu’indiquer la semaine et charger le moteur commun :

- `assets/js/issue-loader.js`
- `assets/css/magazine.css`
- `assets/js/magazine-week.js`

Le contenu éditorial du numéro se trouve dans `data/weeks/YYYY-Sxx.json`.

## Fichiers permanents

- `data/manifest.json` : liste ordonnée des semaines, semaine courante et métadonnées d’accueil.
- `data/works.json` : catalogue permanent des œuvres et historique des apparitions.
- `data/releases.json` : sorties physiques, arrivées streaming et expirations.
- `data/weeks/*.json` : contenu propre à chaque numéro.
- `assets/css/magazine.css` : présentation commune des numéros actuels et futurs.
- `assets/js/magazine-week.js` : comportement commun des numéros actuels et futurs.
- `assets/css/archive.css` et `assets/js/archive-week.js` : compatibilité avec S37 à S39.

## Règles pour une nouvelle semaine

1. Ne jamais recopier le CSS ou le JavaScript dans le nouveau numéro.
2. Créer `data/weeks/YYYY-Sxx.json` avec `schema_version: 1`.
3. Ajouter la semaine à `data/manifest.json` et la définir comme `latest`.
4. Créer uniquement une coquille légère dans `semaines/YYYY-Sxx/index.html`.
5. Réutiliser les identifiants existants de `data/works.json`; enrichir l’historique au lieu de créer un doublon.
6. Mettre à jour `data/releases.json` pour les sorties/expirations.
7. Toute modification graphique globale doit se faire dans les assets partagés.
8. Toute nouvelle fonctionnalité commune doit être ajoutée au moteur partagé, jamais copiée dans chaque semaine.

## Pourquoi

Cette structure permet de conserver des centaines de numéros sans multiplier les copies de CSS et JavaScript. Un changement de design ou de comportement peut être appliqué à tous les numéros magazine en modifiant un seul fichier.


## Couche personnelle locale

Le statut `Vu` reste privé dans `localStorage` (`selectionTV_saved_v1`). Il n’est jamais écrit dans GitHub. Les numéros publics restent donc éditorialement complets, mais `magazine-week.js` masque par défaut, lors du rendu dans le navigateur, les recommandations dont le titre est marqué `vu`.

La préférence `selectionTV_hide_seen_v1` contrôle ce comportement. L’utilisateur peut afficher temporairement les titres déjà vus. Le catalogue et la recherche permanente ne sont pas filtrés : seul l’affichage des recommandations hebdomadaires l’est.

Conséquence : ce filtrage personnel fonctionne sur le navigateur qui possède les données locales ; il ne se synchronise pas entre appareils tant qu’aucun backend privé n’est ajouté.
