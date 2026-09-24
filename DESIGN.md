# Direction artistique — Sélection TV

La refonte conserve le papier chaud, le bleu nuit, les couleurs de rubrique et les compositions distinctes du magazine. Les filets remplacent les cartes arrondies et ombrées. Les titres et critiques utilisent Georgia ; les métadonnées, notes et commandes utilisent une sans-serif système. Aucune police distante n'est nécessaire.

## Audit et corrections

- Suppression des couches CSS V3 à V11 et des correctifs qui réduisaient les textes jusqu'à 4–6 points.
- Correction du conflit `.page > *` qui pouvait annuler le positionnement absolu des bandeaux, retours au sommaire et pieds de page.
- Notes IMDb/SensCritique traitées comme des repères typographiques ; liens documentaires regroupés ; boutons personnels identifiables sans dominer la fiche.
- Affiches affichées en entier, compositions horizontales pour replay et plateformes, colonnes pour les rendez-vous et choix quotidiens.
- Actions des fiches illustrées sur toute la largeur : elles ne s'empilent plus dans la colonne étroite de l'affiche ou du numéro.
- Catalogue, recherche et fiches permanentes partagent `assets/css/site.css`.
- Les tables conservent leur structure HTML et leurs cinq colonnes sur bureau. Sur mobile, chaque ligne passe en flux vertical avec intitulés visibles.

## Pagination de présentation

`page-layout.js` mesure le contenu réel, y compris ses descendants, avant le pied de page. Une grille trop longue est répartie en conservant l'ordre des nœuds ; les deux pages quotidiennes existantes sont utilisées avant de créer une continuation. Une carte trop haute gagne de la largeur. Une œuvre seule sur une continuation reçoit une composition illustrée en pleine largeur.

Les nœuds sont déplacés, jamais recréés : leurs événements, liens et états restent attachés. Avant chaque application de la personnalisation, les positions d'origine sont restaurées. Le moteur `seen-filter.js` conserve ses décisions, quotas et classements. Les numéros de folio et les repères du sommaire sont recalculés uniquement dans le DOM. Les identifiants canoniques et les JSON ne changent pas.

Sous 1160 px, les pages passent en flux libre ; sous 680 px, la lecture devient principalement verticale. L'impression rétablit les feuilles A4 paysage et mesure à nouveau leur contenu sans les actions d'interface. Aucun style `fit-*` ne réduit la police.

## Vérifications

Gates existants :

```sh
node scripts/validate-architecture.mjs
node scripts/validate-editorial.mjs
```

Gate navigateur facultatif, avec Playwright disponible :

```sh
node scripts/validate-layout.mjs
```

Les contrôles couvrent S37 à S40, écran et impression, l'absence de défilement horizontal à 390/768/1100 px, la conservation des textes/liens après recomposition, les boutons personnels, la réserve, le catalogue et les fiches. Les captures de contrôle sont produites hors du dépôt.

Les URL d'affiches et les liens éditoriaux existants sont conservés. La disponibilité des serveurs externes n'est pas garantie par une refonte CSS ; plusieurs images distantes échouaient lors du contrôle. Les deux liens centraux manquants signalés par le validateur éditorial préexistaient à cette refonte.
