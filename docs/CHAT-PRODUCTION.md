# Production hebdomadaire pilotée dans Chat

Décision explicite de l'utilisateur du 16 octobre 2026. Cette décision remplace uniquement les anciens renvois obligatoires vers Work, la production éditoriale horaire et l'obligation de maintenir son agent actif. Elle ne modifie ni l'architecture, ni les schémas, ni les seuils, ni les exigences de preuve et de publication.

## Exécution

L'utilisateur ouvre lui-même une conversation hebdomadaire du projet et joint le magazine Télérama de la cible. Le producteur lit le main et la candidate réels, calcule la cible avec scripts/next-target.mjs, reprend les recherches sauvegardées et produit des lots éditoriaux complets. Télérama est le point de départ, non la source exclusive. Les sources, contrôles et règles de docs/EDITORIAL-TELERAMA.md, docs/EDITORIAL-CLOSURE-POLICY.md et AUTOMATION.md restent applicables.

La rédaction, les recherches, la sélection et le suivi sont conduits pendant la conversation, sans prétendre continuer en arrière-plan après une réponse. Les anciens budgets de passage d'une tâche planifiée ne limitent pas artificiellement cette séance. Le bail coopératif, ses renouvellements et les sauvegardes restent requis pour les écritures concurrentes.

## Transition effectivement observée

- La tâche externe ChatGPT « Sélection TV reprise automatique » (identifiant 6ab9829b7078819183bd87e833be7e07) était active lors du contrôle initial.
- Sa désactivation a été confirmée par automations.update le 2026-10-16 à 12:11:30.761783 UTC. Son prompt et son calendrier ont été conservés, sans suppression ni réactivation des anciennes tâches de phase.
- Une pause n'annule pas une exécution déjà engagée. Le verrou S43 observé à cette transition avait expiré ; toute reprise exige acquisition sans force et vérification de son propriétaire.
- Aucun arrêt global de GitHub Actions, aucune modification des tâches étrangères au projet, aucune migration fictive du moteur ni de quota.

## GitHub et publication

GitHub demeure le dépôt de référence, exécute les validations et assure la publication mécanique protégée d'une livraison réellement achevée. Conserver validate-architecture, les contrôles éditoriaux, sources, liens, images, présentation, Jellyfin et sécurité, la revalidation post-fusion, le publicateur et le watchdog.

Les neuf livrables et data/research/YYYY-Sxx.json sont conservés aux chemins actuels. Les statuts de la candidate restent draft, manifest.latest inchangé. Une revue scellée exige les preuves et la résolution réelle de remaining, pas simplement un workflow vert. La fenêtre de publication reste celle du dépôt : vendredi à partir de 20 h Europe/Paris, puis samedi, sauf instruction nouvelle. Aucun push direct sur main, aucune force, aucune approbation ou validation simulée.

Lorsque le transport direct de fichiers complets n'est pas disponible, utiliser le handoff version 1 de docs/HYBRID-WORKFLOW.md, avec base et empreintes exactes ; ne jamais reconstruire un gros JSON depuis un extrait. Distinguer préparé localement, envoyé, validé et publié.

## Réactivation ultérieure

La tâche éditoriale externe ne peut être réactivée que sur nouvelle demande explicite. Sa description historique et son calendrier sont conservés dans le planificateur. Les validations et le publicateur n'ont pas besoin d'être réactivés puisqu'ils sont maintenus.
