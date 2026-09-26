# Sélection TV — expérimentation Android TV

Ce dossier contient un **overlay minimal** pour construire une APK de test à partir du client officiel Jellyfin Android TV, sans recopier ni modifier durablement son dépôt.

## Base figée

La première expérimentation est construite depuis le tag officiel :

`v0.20.0-beta.3`

Le workflow clone exactement ce tag puis applique uniquement les modifications contenues ici.

## Ce que modifie le prototype

- package debug distinct : `org.jellyfin.androidtv.selectiontv`, donc cohabitation avec Jellyfin officiel ;
- nom de l'application : **Jellyfin Sélection TV** ;
- ajout d'un bouton **Sélection TV** dans la barre de navigation ;
- ajout d'un écran isolé `SelectionTvFragment` ;
- cet écran charge pour l'instant le numéro public courant dans un WebView.

Le reste du client Jellyfin Android TV reste celui du projet officiel.

## Liaison aux fiches Jellyfin

Le pont natif recherche les œuvres avec la session et l’identifiant de l’utilisateur connecté.
Les boutons « Ouvrir dans Jellyfin » ouvrent la fiche native dans la navigation existante.
Un bandeau indique l’avancement, le nombre de films et séries accessibles et les erreurs,
avec une possibilité de relancer la recherche. Les jetons ne sont pas transmis au JavaScript.
Les résultats sont conservés pour les cartes ajoutées dynamiquement ; le WebView recharge
les scripts sans cache. La rubrique privée `Vos Uploads` reste à raccorder sur Android TV.

Validation du correctif : tests du rendu avec réponses simulées (œuvre trouvée, absente,
erreur, pont absent et carte ajoutée après réception), validation de l’architecture et compilation CI.
Le fonctionnement avec le serveur et la télécommande réels nécessite un essai sur la TV.

## Build

Le workflow GitHub Actions `build-selection-tv-androidtv.yml` produit l'artefact :

`Jellyfin-Selection-TV-AndroidTV.apk`

Aucun secret Jellyfin ou Forumactif n'est inclus dans l'APK.
