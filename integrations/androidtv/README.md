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

## Limite volontaire du premier prototype

Ce premier APK sert à valider l'installation parallèle, la connexion au serveur Jellyfin, la navigation à la télécommande et l'affichage de Sélection TV sur un téléviseur.

L'écran Sélection TV n'exploite pas encore la session native Jellyfin pour les badges « Dans Jellyfin », l'ouverture native des fiches ou `Vos Uploads`. Ces ponts seront ajoutés seulement après validation de ce premier palier.

## Build

Le workflow GitHub Actions `build-selection-tv-androidtv.yml` produit l'artefact :

`Jellyfin-Selection-TV-AndroidTV.apk`

Aucun secret Jellyfin ou Forumactif n'est inclus dans l'APK.
