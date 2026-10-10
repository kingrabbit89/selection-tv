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

Pour la reprise, appliquer la section « Progression de la recherche et impasses » d'AUTOMATION.md. Le champ `stage` indique le travail en cours, pas une certification de toutes les phases précédentes : `enrichment` est autorisé après le relevé primaire des sept jours, même si des recoupements restent dans `remaining`. `ready` exige toujours leur résolution réelle et tous les livrables revus.

Le registre additionnel `research_attempts` conserve les impasses et leurs conditions de reprise. Un dossier non retenu reste documenté, mais ne doit pas monopoliser les passages sans piste nouvelle. Les lacunes de couverture obligatoire et les défauts des recommandations/réserves restent bloquants. La réorganisation de `remaining` doit conserver chaque exigence ouverte ; ni report ni regroupement ne vaut achèvement.

Une sauvegarde de checkpoint n'achève pas automatiquement le passage : appliquer « Enchaîner les lots pendant un passage » d'AUTOMATION.md, continuer immédiatement tant qu'un lot utile peut avancer, puis consigner `stop_reason` et le prochain lot dans `run_metrics` lorsque l'exécution le permet. La reprise horaire récupère une interruption ; elle ne limite pas le passage à une seule fiche.

Un clone peut extraire une vue de travail en lecture seule avec `node scripts/editorial-work-packet.mjs YYYY-Sxx --ref SHA_CANDIDATE`, puis `--title "Titre exact"` pour réunir les données et preuves d'une œuvre. Le SHA doit être celui du checkpoint réellement lu. Ce paquet ciblé est distinct du handoff d'import ; il ne contient aucune attestation de qualité ou autorisation de publication.

Utiliser `--compact` pour les lectures de travail et `--offset N --limit N` pour parcourir les correspondances. Relire les exigences globales avant certification. Pour transformer plusieurs décisions revues en catalogue, liens, cartes, pools et grilles, suivre `docs/EDITORIAL-DRAFTS.md` et `scripts/editorial-draft-cards.mjs`. L'outil rend un handoff partiel, jamais une sélection ou une publication automatique.

Avant de choisir un lot, `node scripts/preparation-gaps.mjs YYYY-Sxx` (ou l'artefact `preparation-gaps-YYYY-Sxx` de la CI) liste les écarts des validateurs de candidate par jour, rubrique et livrable, à titre informatif et non certifiant. La présélection `shortlist` et le champ facultatif `remaining_items` sont décrits dans AUTOMATION.md. La consigne active est conservée dans `docs/EDITORIAL-AGENT-PROMPT.md`. Les anciens champs de reprise ne priment pas sur les contrats courants : réconcilier leur phase et leurs prochaines actions avec les preuves et livrables réels. Réutiliser la lecture d'un document statique seulement si son blob et sa lecture précédente sont attestés ; les disponibilités du cycle restent à vérifier.

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
- Promotion périmée après une mise à jour de main : `synchronize-promotion.mjs` reprend automatiquement une PR ouverte seulement si son diff depuis sa base d'origine est l'exacte transaction de publication, et si une nouvelle attestation réussit pour le SHA courant de main. Il applique les seuls statuts aux données actuelles de main, crée un commit de fusion dont les parents sont l'ancienne tête et ce main, puis avance la branche sans force. Les références et l'état ouvert de la PR sont relus avant l'avancement ; une modification concurrente interdit de remplacer sa tête. Cette étape ne fusionne pas la PR : tous les nouveaux checks sont obligatoires au passage suivant. Une modification éditoriale/code dans l'ancienne transaction, une PR fermée/Draft/étrangère ou une attestation absente/rouge reste un blocage.
  Avec le jeton intégré, les nouveaux contrôles de PR peuvent exiger une approbation explicite. Le résumé signale cette dépendance et le watchdog conserve `publication-pending` : la synchronisation sûre ne prouve pas une publication autonome. Un jeton dédié valide permet le déclenchement sans cette approbation ; sa présence seule ne garantit pas sa validité, et une erreur d'API bloque toujours l'opération.
- Après fusion : demande explicite de build Pages, puis vérification publique lors d'un passage suivant. Le watchdog conserve son rôle d'alerte. Une fusion n'est pas présentée comme un déploiement vérifié.

Le publicateur n'exécute jamais le code d'une PR avec ses droits d'écriture. Une candidate périmée, une promotion qui ne remplit pas les conditions de synchronisation ci-dessus, un conflit, un check rouge/en attente/ignoré, une approbation nécessaire ou une permission manquante bloquent l'étape et sont visibles dans Actions. Work intervient alors sur la cause précise, sans refaire l'inventaire entier.

Sur une préparation qui ne change que research/inventory/coverage, `preparation-regressions.mjs` peut réutiliser les contrôles lourds du numéro public, uniquement si le dernier run push de l'exacte base main a moins d'une heure et contient réellement les deux jobs et les étapes images, rendu et Jellyfin réussis. Une preuve absente, périmée, illisible ou un dernier run non réussi relance les contrôles complets. Les invariants de préparation sont toujours rejoués ; la barrière `--require-ready` reste rouge tant que le numéro manque. Toute modification du code, catalogue ou pages, et toute candidate ready, reçoit les contrôles complets. Un navigateur vert sur le public ne certifie pas la candidate.

Les événements de validation reçus par le publicateur sont limités à main, auto/** et promote/** ; les corrections techniques continuent d'être validées sans lancer un publicateur sans travail possible. Les schedules et déclenchements manuels demeurent.

Une revalidation de promotion dont seul le job `resolve` réussit ne permet pas d'avancer : le publicateur exige le job `validate-promotion` et son étape d'attestation réellement réussis. Le watchdog ne réconcilie pas un publicateur vert dont l'étape d'avancement a été sautée ; les échecs ou preuves API illisibles conservent la surveillance. Quelques exécutions légères restent visibles pour inspecter les jobs sources, sans publication ni traitement d'alerte lorsqu'elles ne trouvent aucun travail.

## Authentification GitHub : autonomie complète conditionnelle

Par défaut, les workflows emploient GITHUB_TOKEN. Selon la politique du dépôt, la création de PR peut être interdite ou leurs contrôles demander une approbation explicite. Le code ne modifie pas ces politiques et ne contourne pas les protections.

Pour supprimer l'approbation des workflows imputable au jeton intégré, un administrateur peut fournir un secret de dépôt `WEEKLY_PUBLISH_TOKEN`, limité à ce dépôt : Contents et Pull requests en écriture, Actions en écriture (revalidation), Checks et Commit statuses en lecture, Pages en écriture (build). Employer un compte/jeton autorisé sans bypass de main ; un jeton expiré bloque la chaîne. Une GitHub App dédiée est également envisageable mais nécessite de gérer ses jetons courts. Aucun secret n'est requis pour préparer ou tester les fichiers localement.

Ne jamais coller un jeton dans une conversation ou un fichier. La présence du secret et un cycle réel doivent être vérifiés avant de déclarer le système autonome. Les cinq anciennes tâches sont conservées en pause. Une tâche unique effectue les reprises de toutes les phases, chaque heure de 8 h à 23 h jeudi/vendredi/samedi, à partir du 8 octobre 2026 (Europe/Paris). Les phases demeurent des jalons éditoriaux, pas des déclencheurs concurrents. L'économie de quota Work n'est pas chiffrée et leur moteur n'a pas changé.

Sources de comportement : https://docs.github.com/en/actions/concepts/security/github_token ; https://learn.chatgpt.com/docs/automations.

## Reprises opérationnelles testées

La tâche éditoriale utilise un verrou coopératif sur `locks/editorial-YYYY-Sxx`. Le helper `scripts/editorial-lease.mjs` implémente acquire/check/renew/release par commits et références Git sans force. Exemple : `node scripts/editorial-lease.mjs acquire 2026-S42` renvoie un owner à conserver ; le passer aux commandes check/renew/release. Bail de 60 minutes, renouvellement après 20 minutes, contrôle avant chaque écriture. Une expiration ou perte de propriété interdit de poursuivre. Les tests simulent une interruption, une acquisition concurrente, un renouvellement et un verrou illisible. Ils ne constituent pas un test de charge réel du planificateur. Si le shell n'a pas d'authentification GitHub, appliquer le même protocole via les outils connectés ; ne pas inventer un accès.

**Draft des données et Draft PR sont distincts.** Laisser les JSON en draft jusqu'à promotion. Créer une PR GitHub normale (`draft: false`) ; si une PR provisoire est Draft, la passer explicitement en Ready for review seulement une fois sa revue terminée. Ne pas contourner le refus de fusion des Draft PR.

Une branche promote créée sans PR peut être reprise automatiquement uniquement si elle contient l'exacte transaction de deux fichiers, un seul commit au-dessus du main courant, après attestation du SHA exact de main. Aucune branche périmée, modifiée ou associée à une PR volontairement fermée n'est réouverte automatiquement. Les contrôles de la nouvelle PR restent indispensables.

Le watchdog conserve son passage du samedi à 10:00 UTC, ajoute des passages de 11:20 à 23:20 UTC, et réconcilie les alertes après les exécutions du publicateur. Les événements du publicateur ne créent pas une nouvelle alerte : ils ferment l'alerte existante seulement après vérification publique. Les passages tardifs du samedi UTC qui tombent dimanche à Paris contrôlent encore le cycle du samedi. La surveillance des nouvelles versions Android reste séparée des événements de publication.

Le résumé du publicateur indique seulement si un jeton dédié est configuré ou si le jeton intégré est utilisé. Aucune valeur secrète n'est affichée. La présence d'un jeton ne prouve ni sa validité ni toutes ses permissions ; seules des opérations réelles autorisées peuvent les établir.

## PDF Télérama fourni : référence de grille

Le PDF de la bonne cible fait autorité pour ses titres imprimés, chaînes, jours
et heures après revue de transcription, selon AUTOMATION.md et
docs/EDITORIAL-TELERAMA.md. La seconde lecture des omissions reste requise, mais
la provenance EPG inconnue ne bloque pas les faits arbitrés par ce PDF. Conserver
les preuves de revue et limites sans déclarer une indépendance inconnue. Les
contrôles hors PDF et les barrières de publication restent applicables.
