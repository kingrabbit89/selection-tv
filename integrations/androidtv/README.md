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


## Correctif de stabilité — protocole 4 (27 septembre 2026)

Le retour depuis une fiche conserve la WebView, le focus, les UUID et l’index de la session. Un changement de serveur ou de compte les invalide. Le statut vu de la fiche ouverte est revérifié au retour sans effacer la dernière réponse confirmée pendant une requête ou une erreur réseau. Les lignes ne sont plus réinitialisées toutes les minutes et une réserve déjà affichée garde sa priorité.

L’indexation est limitée à 60 secondes, avec un délai de 8 secondes par page et un compteur de progression. En cas d’échec, les recherches ciblées restent disponibles ; une ouverture de fiche n’attend jamais le balayage de toute la bibliothèque. L’API reçoit explicitement l’utilisateur connecté pour les données de visionnage. Les erreurs de recherche native restent des erreurs, jamais des preuves d’absence.

Les tests de navigateur simulent les retours, les délais dépassés, les résultats tardifs et l’inactivité. Une installation de cette APK est nécessaire pour le cycle de vie natif ; ces tests ne remplacent pas un essai sur le serveur et le Fire TV physiques. « Vos Uploads » reste réservé à Jellyfin Web.
