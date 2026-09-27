# Reprise des blocages de l’audit — 27 septembre 2026

Base réelle : `4ebcf6e47494e38fa78446e97ce950c5270859a2`. Correctifs proposés par PR #27.

## Corrections

- Calendrier partagé entre génération, validation et promotion. Le samedi appartient au cycle courant ; les semaines manquées sont sautées explicitement, sans publier des programmes périmés. Tests de changement d’année et d’heure.
- Revalidation de la cible draft sur le SHA exact de main, après modifications de main et toutes les heures les vendredis/samedis. Aucun contenu incomplet n’est promu par ce workflow.
- Rapport post-fusion exécuté même après échec ; watchdog distinguant absence, attente de PR, brouillon bloqué et déploiement Pages défaillant. Une alerte par semaine, clôturée après vérification réussie.
- Unicité canonique contrôlée. McCartney conserve ses occurrences et affiche ; Mandalorian conserve son ancienne URL et les identifiants Vu. Références radar migrées.
- Notes canoniques prioritaires sur les cartes ; réserve utilisée une seule fois entre pages d’une même rubrique.
- Fire TV : réserves quotidiennes, rendez-vous et sorties physiques ; `played=null` distinct de false ; échec de détail natif traité comme une erreur ; réponses tardives isolées par requête/session ; reprise après pause et revalidation périodique ; aucune restauration de correspondances d’un autre compte depuis le stockage partagé.
- TMDb : les identifiants `/movie/` ne correspondent plus aux séries portant le même numéro. Homonymes d’année identique : pas de sélection arbitraire dans les chemins exacts corrigés.
- Jellyfin Web : détails/caches privés par compte, invalidation du pont lors d’un changement de session et indication d’indisponibilité du forum.
- Inventaire candidat : jours uniques dans la période cible, programmes non dupliqués et au moins deux domaines de sources. Deux domaines sont une condition minimale, pas une preuve suffisante d’indépendance éditoriale.
- Refus des prétextes de notes « non vérifiées/non indispensables » dans la readiness stricte.

Vos Uploads reste exclusivement Web.

## Enrichissements prouvés

Trois synopsis complétés et durée de Finzi-Contini renseignée, sans modification des horaires :

- Finzi-Contini : https://www.cinematheque.fr/film/41861.html
- Hondo : https://www.arte.tv/fr/videos/079357-000-A/hondo-l-homme-du-desert/
- Hard Eight : https://www.paramountpictures.com/movies/hard-eight

## Ce que cette livraison ne certifie pas

La readiness S41 demeure **28/66 candidats complets et 12/45 réserves quotidiennes complètes**. Les autres fiches nécessitent une recherche réelle ; leurs lacunes ne sont pas masquées par des données inventées. Les barrières S42 restent strictes.

Le premier cycle de production éditoriale S42, suivi de S43, n’a pas encore eu lieu. Les tests utilisent des fixtures identifiées comme telles ; ils ne démontrent pas la collecte future de toutes les grilles.

La ruleset n’a pas été modifiée. Une dernière lecture du SHA de main avant fusion réduit la course, sans rendre atomique la comparaison de base. Une règle GitHub exigeant la branche à jour ou une merge queue reste nécessaire pour éliminer cette fenêtre côté serveur.

Le protocole Android passe à **3**. L’APK compilée doit être installée sur Fire TV ; le wrapper doit être remplacé sur le serveur Jellyfin. Le dépôt ne déploie pas à distance sur ces appareils privés. Aucun test matériel ni connexion au serveur privé n’est revendiqué.

Ces limites empêchent encore de certifier une autonomie intégrale sans surveillance, même avec les contrôles techniques verts.
