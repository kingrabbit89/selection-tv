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

## Intégration Jellyfin

Sélection TV peut être intégré directement dans **Jellyfin Web** comme page utilisateur. L'objectif est de conserver l'expérience éditoriale du site tout en la rapprochant de la médiathèque personnelle : une œuvre présente dans Jellyfin peut ensuite être reconnue et ouverte depuis Sélection TV.

> **Statut : intégration optionnelle et expérimentale.**  
> L'affichage dans Jellyfin est fonctionnel. Le pont avec la bibliothèque Jellyfin (détection des œuvres, ouverture de la fiche, puis à terme état *Vu* et qualité disponible) est encore en cours de stabilisation.

### Configuration testée

La procédure ci-dessous a été testée avec :

- Jellyfin Server / Web **10.11.11** ;
- **File Transformation 3.0.1.0** ;
- **Plugin Pages 3.0.1.0**.

Les deux plugins tiers sont publiés par [IAmParadox27](https://github.com/IAmParadox27).

### Installation

1. Ajouter le dépôt de plugins suivant dans Jellyfin :

   ```text
   https://www.iamparadox.dev/jellyfin/plugins/manifest.json
   ```

2. Installer **File Transformation** puis **Plugin Pages**, et redémarrer Jellyfin.

3. Copier le fichier fourni dans ce dépôt :

   ```text
   integrations/jellyfin/selection-tv.html
   ```

   dans le répertoire `jellyfin-web` de l'installation Jellyfin.

   Sous Windows, l'emplacement courant est :

   ```text
   C:\Program Files\Jellyfin\Server\jellyfin-web\selection-tv.html
   ```

4. Créer le fichier de configuration de Plugin Pages :

   ```text
   C:\ProgramData\Jellyfin\Server\plugins\configurations\Jellyfin.Plugin.PluginPages\config.json
   ```

   avec :

   ```json
   {
     "pages": [
       {
         "Id": "selection-tv",
         "Url": "selection-tv.html",
         "DisplayText": "Sélection TV",
         "Icon": "live_tv"
       }
     ]
   }
   ```

5. Redémarrer Jellyfin. Une entrée **Sélection TV** doit apparaître dans le menu utilisateur.

### Rubrique privée « Vos Uploads »

Une extension optionnelle permet d'ajouter au numéro affiché dans Jellyfin une rubrique **Vos Uploads — dernières 24 heures**, sans publier les données du forum dans GitHub Pages.

Le composant serveur se trouve dans :

```text
integrations/jellyfin/private-uploads/
```

Son fonctionnement est séparé du site public :

1. Jellyfin se connecte au forum côté serveur avec un compte autorisé ;
2. il récupère le flux du sous-forum dans cette session authentifiée ;
3. le titre technique de chaque topic est nettoyé pour en déduire le film et son année ;
4. l'intégration utilise d'abord la bibliothèque Jellyfin puis la recherche distante de métadonnées de Jellyfin pour identifier l'œuvre et récupérer notamment son affiche ;
5. le numéro reçoit les fiches privées par `postMessage` uniquement lorsqu'il est chargé dans Jellyfin ;
6. chaque fiche conserve le lien vers le topic d'origine et les commandes personnelles de Sélection TV.

L'endpoint `/SelectionTv/Uploads` est protégé par l'authentification Jellyfin. Aucun JSON contenant les topics privés n'est écrit dans le site public.

Le plugin est compilé automatiquement par GitHub Actions sous le nom d'artefact **SelectionTvPrivate-Jellyfin-10.11**. Sa configuration locale est documentée dans `integrations/jellyfin/private-uploads/README.md`.

Les identifiants du forum ne doivent jamais être inscrits dans le dépôt. Ils sont placés uniquement dans le fichier de configuration local du serveur Jellyfin.

### Cache Jellyfin Web

Après une mise à jour de **File Transformation**, **Plugin Pages** ou du fichier `selection-tv.html`, Jellyfin Web peut continuer à utiliser d'anciens bundles en cache. Si l'entrée apparaît mais ouvre une page introuvable ou une ancienne version, vider les données du site dans le navigateur ou tester dans une fenêtre privée permet de confirmer rapidement un problème de cache.

### Sécurité

Aucune clé API Jellyfin ne doit être placée dans le site GitHub Pages public. L'intégration est conçue pour utiliser le contexte de la session Jellyfin côté page locale.

## Prototype Android TV

Une APK expérimentale basée sur Jellyfin Android TV est compilée automatiquement depuis `integrations/androidtv/`. Elle utilise un package distinct et peut cohabiter avec l'application Jellyfin officielle.

La page de téléchargement permanente est :

`https://kingrabbit89.github.io/selection-tv/androidtv/`

Le workflow publie également l'APK sous un asset GitHub Release stable nommé `Jellyfin-Selection-TV-AndroidTV.apk`.

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
