# Sélection TV : production hybride et reprise

## Rôles et limite actuelle

Chat peut effectuer la recherche Web, comparer les critiques, sélectionner et rédiger selon AUTOMATION.md. Work sert à l'intégration difficile et aux corrections techniques. GitHub exécute les contrôles et le publicateur mécanique. Tous utilisent les mêmes fichiers et les mêmes critères, notamment la prospection documentaire sourcée, sans personnalisation selon les goûts.

Les outils de gestion des cinq tâches permettent de modifier leur prompt et leur calendrier, pas de sélectionner Chat à la place de Work ni de basculer sur un quota différent. Leur moteur n'est donc PAS migré par cette modification. La reprise dans Chat est explicite. Un prompt demandant « utiliser Chat » ne crée ni un autre moteur ni un budget supplémentaire.

## Reprendre dans Chat sans accès en écriture au dépôt

1. Dans Actions, lancer **Prepare editorial handoff for Chat** sur main. Télécharger l'artefact `editorial-handoff-context`. Il contient le paquet de travail `YYYY-Sxx.json` et `context.json` (instructions, configurations, SHA et empreintes). La cible déjà publiée est refusée : ce workflow prépare le cycle calendaire encore à produire.
2. Joindre ces fichiers à une conversation Chat disposant de la recherche Web. Demander : « Reprends Sélection TV selon les instructions de context.json. Réutilise ce qui est vérifié, conserve les sources exactes, complète le paquet YYYY-Sxx.json sans publier ni inventer. Indique les recherches restantes. »
3. Chat modifie les `content` du paquet. Chaque `base_sha256` reste celui de l'export ; il ne doit jamais être recalculé pour masquer un conflit. Pour un nouveau fichier autorisé, utiliser `base_sha256: null` et le contenu complet. Retirer les fichiers inchangés est possible. Conserver `week` et `base_sha`.
4. Dans GitHub, créer une branche `handoff/YYYY-Sxx` depuis main et y téléverser le paquet sous `handoffs/YYYY-Sxx.json` (Add file / Upload files). Ne pas déposer de secrets ou de fichiers privés. Lancer **Import editorial handoff** depuis main avec `bundle_ref = handoff/YYYY-Sxx`.
5. L'import applique uniquement les fichiers éditoriaux autorisés, crée ou met à jour `auto/YYYY-Sxx` et sa PR. Il refuse toute collision avec une modification plus récente et toute promotion. Si GitHub demande **Approve workflows to run**, approuver explicitement les contrôles de cette PR. Aucune approbation n'est simulée par le publicateur.

Cette voie fonctionne sans Work pour l'import et les contrôles. Elle comprend le transfert manuel des fichiers lorsque Chat n'a pas d'outil GitHub en écriture. Chat peut utiliser un outil connecté autorisé s'il est réellement disponible ; ne jamais le présumer.

## Paquet commun et checkpoints

Schéma version 1 : `schema_version`, `week`, `base_sha`, `stage` (`inventory`, `enrichment`, `ready`), `remaining` (liste explicite), `files` (objets `path`, `base_sha256`, `content`). Les contenus sont des fichiers complets, pas des fragments ou des commandes.

Chemins autorisés : les neuf livrables de data/automation-config.json et `data/research/YYYY-Sxx.json`. Un lot peut être partiel. Les imports identiques sont sans effet ; une empreinte divergente impose une réconciliation. Aucun fichier de code, workflow, autre semaine, suppression ou changement de latest n'est admis.

À chaque journée ou lot réellement terminé, commiter les résultats sur auto/YYYY-Sxx et mettre à jour `data/research/YYYY-Sxx.json`, par exemple :

```json
{"week":"2026-S42","stage":"inventory","remaining":["Contrôler dimanche avec une seconde source","Compléter la prospection france.tv"],"completed_batches":["samedi : sources et inventaire enregistrés"],"blockers":[]}
```

Ne jamais écrire « ready » pour un simple inventaire. Avant de déclarer la revue complète, résoudre toutes les lignes remaining, vérifier les preuves et les exigences d'AUTOMATION.md. Le CI ne remplace pas cette revue.

Avec un environnement de code :

```sh
node scripts/editorial-handoff.mjs export 2026-S42 BASE_SHA /tmp/2026-S42.json enrichment
node scripts/editorial-handoff.mjs check /tmp/2026-S42.json
node scripts/editorial-handoff.mjs apply /tmp/2026-S42.json
node scripts/seal-editorial-review.mjs 2026-S42 --review-completed
```

La dernière commande enregistre les SHA-256 des neuf livrables après revue ; elle ne vérifie pas les sources. Dans Chat sans shell, produire les mêmes empreintes avec l'outil d'analyse de fichiers s'il est disponible. Sinon confier cette seule opération au préflight Work. Toute modification d'un livrable rend la revue enregistrée périmée ; revoir les changements avant de la renouveler.

## Publicateur GitHub

**Weekly protected publisher** avance au maximum une étape par passage, le vendredi à partir de 20 h et le samedi, fuseau Europe/Paris. Il est déclenché après les validations réussies et toutes les demi-heures vendredi/samedi (les heures GitHub peuvent être retardées).

- Candidate : même dépôt, branche auto de la cible, uniquement fichiers éditoriaux autorisés, revue explicite liée aux contenus, tous les checks applicables terminés/successful, dont data-and-policy et browser-presentation. Main doit être ancêtre de la tête. Fusion avec SHA attendu, sans bypass.
- Brouillon fusionné : revalidation post-fusion existante. Le publicateur exige l'artefact promotion-ready pour le SHA exact de main avant de créer la PR promote.
- Promotion : seuls manifeste et statut hebdomadaire changent. Les mêmes checks doivent réussir et l'attestation doit toujours correspondre à main avant fusion.
- Après fusion : demande explicite de build Pages, puis vérification publique lors d'un passage suivant. Le watchdog conserve son rôle d'alerte. Une fusion n'est pas présentée comme un déploiement vérifié.

Le publicateur n'exécute jamais le code d'une PR avec ses droits d'écriture. Un conflit, une branche périmée, un check rouge/en attente/ignoré, une approbation nécessaire ou une permission manquante bloquent l'étape et sont visibles dans Actions. Work intervient alors sur la cause précise, sans refaire l'inventaire entier.

## Authentification GitHub : autonomie complète conditionnelle

Par défaut, les workflows emploient GITHUB_TOKEN. Selon la politique du dépôt, la création de PR peut être interdite ou leurs contrôles demander une approbation explicite. Le code ne modifie pas ces politiques et ne contourne pas les protections.

Pour supprimer l'approbation des workflows imputable au jeton intégré, un administrateur peut fournir un secret de dépôt `WEEKLY_PUBLISH_TOKEN`, limité à ce dépôt : Contents et Pull requests en écriture, Actions en écriture (revalidation), Checks et Commit statuses en lecture, Pages en écriture (build). Employer un compte/jeton autorisé sans bypass de main ; un jeton expiré bloque la chaîne. Une GitHub App dédiée est également envisageable mais nécessite de gérer ses jetons courts. Aucun secret n'est requis pour préparer ou tester les fichiers localement.

Ne jamais coller un jeton dans une conversation ou un fichier. La présence du secret et un cycle réel doivent être vérifiés avant de déclarer le système autonome. Les cinq tâches existantes restent un secours tant que cette validation n'a pas eu lieu. L'économie de quota Work n'est pas chiffrée et leur moteur n'a pas changé.

Sources de comportement : https://docs.github.com/en/actions/concepts/security/github_token ; https://learn.chatgpt.com/docs/automations.
