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
- `data/radar-reserves/*.json` : réservoirs classés des deux radars, chargés comme données JSON sans déplacer la logique éditoriale dans le JavaScript.
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

Le statut `Vu` reste privé dans `localStorage` (`selectionTV_seen_v2`, avec compatibilité `selectionTV_saved_v1`). Il n’est jamais écrit dans GitHub. Les numéros publics restent donc éditorialement complets, tandis que `seen-filter.js` masque par défaut, lors du rendu dans le navigateur, les recommandations déjà vues.

La préférence `selectionTV_hide_seen_v1` contrôle le masquage dans les numéros. Le catalogue, la recherche globale et chaque fiche permanente restent toujours consultables et servent aussi d’interface de gestion : un bouton permet d’y marquer une œuvre comme `Vu` ou d’annuler ce statut, ce qui permet de corriger facilement une erreur sans rechercher l’œuvre dans un numéro hebdomadaire.

Conséquence : ce filtrage personnel fonctionne sur le navigateur qui possède les données locales ; il ne se synchronise pas entre appareils tant qu’aucun backend privé n’est ajouté.


## Réservoir éditorial et remplacement des déjà-vus

À partir de S41, chaque journée possède dans le JSON hebdomadaire un pool classé de candidats pour les choix développés. Le numéro public conserve sa hiérarchie éditoriale : les trois premiers restent les trois choix officiels. Le navigateur applique ensuite l’historique privé `Vu`.

Le moteur utilise un registre stable `selectionTV_seen_v2` fondé autant que possible sur les `work_id` de `data/works.json`. Les anciens statuts `vu` de `selectionTV_saved_v1` sont migrés automatiquement lorsqu’un identifiant stable est disponible.

Pour chaque journée :
- objectif d’affichage : 3 choix développés ;
- objectif de réservoir : 10 candidats classés ;
- minimum normal : 8 candidats ;
- si moins de 8 programmes dépassent réellement le seuil éditorial, le JSON doit contenir `shortage_reason` plutôt que d’ajouter des recommandations médiocres.

Au chargement, le navigateur conserve les choix principaux non vus et remplit les places libérées avec les meilleurs candidats suivants du réservoir. Le bouton « Afficher les vus » restaure l’affichage canonique. Les grilles commentées constituent un ensemble logique unique par jour : après masquage, les lignes restantes sont repaginées depuis la première page, la seconde page disparaît lorsqu’elle n’est plus nécessaire et, si le pool contient des candidats supplémentaires au-dessus du seuil éditorial, ceux-ci complètent la grille jusqu’au quota prévu.

Cette personnalisation reste locale : la tâche hebdomadaire ne lit jamais l’historique privé de l’utilisateur et le dépôt GitHub conserve toujours la sélection complète.


## Index hebdomadaire

Les numéros magazine ne génèrent plus de page d’index alphabétique. Cette page doublonnait le catalogue et la recherche globale, devenait incomplète dès que plusieurs rubriques coexistaient et compliquait la pagination. Pour retrouver une œuvre, le point d’entrée canonique est `catalogue.html` ou `recherche.html`, puis `oeuvre.html` pour la fiche permanente.


## Plateformes avec abonnement

La rubrique doit être plus fournie que les premières versions du magazine : cible normale de 9 recommandations, sans obligation de remplissage si le niveau éditorial n’est pas atteint.

Les pages plateformes peuvent être multipliées : la lisibilité des métadonnées, notes et liens prime sur un nombre de pages fixe. Les fiches directes IMDb, SensCritique et AlloCiné doivent être conservées lorsqu’elles existent, avec les notes disponibles relevées à la date du numéro.

La hiérarchie est **film-first** :
- viser au moins 80 % de longs métrages lorsque l’offre de la semaine le permet ;
- privilégier les sorties de la semaine, puis les films arrivés récemment et encore disponibles ;
- ne pas chercher à équilibrer artificiellement Netflix, CANAL+, Apple TV, Prime Video, HBO Max, etc. ;
- une série n’entre dans la sélection que comme exception forte : reconnaissance critique établie, auteur ou distribution majeure, singularité formelle ou importance culturelle. Le simple fait d’être une nouveauté ne suffit pas.


## Radars personnalisables

Les deux radars utilisent la même logique locale de remplacement que les sélections quotidiennes, sans modifier la sélection publique canonique.

### Radar de popularité
- page 1 : 5 titres issus du classement public courant ;
- page 2 : 5 titres de **sillonnage élargi**, repérés dans une fenêtre glissante de 60 jours parmi les films récemment très circulants mais sortis du Top 10 courant ;
- réserve distincte : au moins 5 candidats supplémentaires, afin que les choix de la page principale puissent être remplacés sans dupliquer la page de sillonnage ;
- le même seuil éditorial s’applique aux trois niveaux : classement courant, sillonnage, réserve ;
- lorsqu’un titre principal est déjà marqué `Vu`, le meilleur candidat suivant de la réserve prend sa place.

### Radar 1080p
- 10 titres visibles, répartis sur deux pages de cinq ;
- objectif normal de 20 candidats au total, soit 10 choix publics et 10 choix de réserve ;
- fenêtre de repérage de 21 jours pour les restaurations, rééditions, premières éditions HD et réapparitions intéressantes ;
- la page récapitulative est reconstruite dans le navigateur pour refléter les dix titres réellement affichés après personnalisation.

Les réserves conservent les mêmes métadonnées, notes, liens de fiches et boutons personnels que les cartes principales. Elles sont stockées dans `data/radar-reserves/YYYY-Sxx.json` ; le JavaScript commun ne contient que la logique de remplacement. Le design Astra et la structure des pages restent inchangés.


## Images et affiches

`data/works.json` est la source canonique des visuels d’œuvre. Une œuvre affichée sous forme de carte visuelle ou placée dans une réserve éditoriale doit normalement posséder :
- `image` : visuel principal ;
- `image_source_url` : page/source ayant permis de vérifier le visuel ;
- `image_checked` : date de la dernière vérification ;
- `image_fallbacks` : URLs alternatives lorsqu’elles existent.

La recherche suit une cascade : source officielle ou éditeur, base cinéma fiable, puis recherche d’images web ciblée (`titre + année + poster/affiche` ; pour une réédition, `titre + Blu-ray/4K cover`). Une miniature de moteur de recherche n’est pas considérée comme source canonique : elle sert à retrouver et vérifier le fichier/source d’origine.

`assets/js/image-resolver.js` hydrate les cartes à partir du catalogue canonique et essaie automatiquement les URLs de secours si un hébergeur refuse le hotlink ou si une image disparaît. Les cartes générées dynamiquement par le système `Vu` bénéficient du même traitement. Les numéros d’archive S37 à S39 utilisent le même résolveur : les anciens `poster-fallback` sont remplacés à l’affichage dès qu’un visuel canonique existe dans `works.json`.

Une absence d’image n’est admise qu’avec `image_exception_reason`, par exemple pour une carte éditoriale d’agrégation sans œuvre unique. À partir de S41, la validation éditoriale bloque une publication qui contient une carte visuelle ou un candidat de réserve sans image ni exception documentée.
