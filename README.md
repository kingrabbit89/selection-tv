# Sélection TV

**Sélection TV** est une publication hebdomadaire consacrée aux films, documentaires, replays, plateformes et sorties à voir.

## Voir le site

### [Ouvrir Sélection TV](https://kingrabbit89.github.io/selection-tv/)

Le site est publié avec **GitHub Pages** : aucune installation n’est nécessaire pour le consulter.

## Principe

Chaque semaine prend la forme d’un numéro éditorialisé comprenant notamment :

- les rendez-vous prioritaires de la semaine ;
- les programmes à récupérer en replay ;
- les sélections des plateformes gratuites et par abonnement ;
- les sorties physiques et streaming ;
- les programmes à voir avant disparition ;
- les radars de disponibilité/popularité ;
- une sélection jour par jour.

Le site conserve localement dans le navigateur certains états personnels, notamment les œuvres marquées **Vu** et **À récupérer**. Lorsqu’une œuvre déjà vue doit disparaître d’une sélection, le système peut faire remonter une recommandation de réserve préparée pour la semaine.

## Données et fonctionnement

Le site est statique et fonctionne sans backend applicatif.

- Les numéros sont décrits dans `data/weeks/*.json`.
- Le catalogue d’œuvres et les visuels canoniques sont centralisés dans `data/works.json`.
- Les liens vérifiés sont centralisés dans `data/links.json`.
- Les comportements communs des numéros sont gérés par les scripts de `assets/js/`.
- Les pages hebdomadaires légères se trouvent dans `semaines/YYYY-Sxx/`.

Les nouveaux numéros réutilisent le même moteur de rendu et les mêmes contrôles de qualité.

## Contrôles avant publication

GitHub Actions vérifie automatiquement l’architecture et les données éditoriales, la politique de liens exacts, ainsi que le rendu réel dans Chromium : pagination, sommaire, défilement jusqu’à la dernière page, responsive, images, réserves et fonctionnement du système **Vu**.

## Statistiques d’audience

Le site est prêt pour une mesure d’audience légère avec **GoatCounter**. L’intégration est désactivée tant que `data/analytics.json` ne contient pas un code de site et `enabled: true`. Une fois activée, elle mesure les pages vues et permet également de compter les interactions générales avec **Vu** et **À récupérer**, sans envoyer les titres personnels enregistrés dans le navigateur.

## Lancer le site en local

Le site charge des fichiers JSON avec `fetch()` : il faut donc le servir avec un petit serveur HTTP plutôt que d’ouvrir directement `index.html` en `file://`.

Par exemple, après avoir cloné le dépôt :

```bash
git clone https://github.com/kingrabbit89/selection-tv.git
cd selection-tv
python -m http.server 8000
```

Puis ouvrir :

```text
http://localhost:8000/
```

## Documentation technique

- [Architecture](ARCHITECTURE.md)
- [Direction visuelle](DESIGN.md)
