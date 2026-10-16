# Audit complémentaire : isolation des tests et cycles hebdomadaires

Date : 16 octobre 2026. Base examinée : `8714a3b6116d95148719e9a402fcde482dbdd436` (après le correctif #71).

## Périmètre et méthode

Contrôle du code réellement présent sur cette base, puis exécution locale sous Node 22.16.0. Les scénarios utilisent des fichiers et dépôts Git temporaires ; ils n'appellent pas l'API GitHub et ne publient aucun numéro réel. Les résultats CI finaux sont à lire sur le SHA exact de la PR associée. La collecte initiale des objets Git suivis du dépôt public n'incluait aucun secret ni fichier de runner ; son workflow temporaire est retiré du diff final.

Deux vérifications étaient demandées : les tests lançant des sous-processus, puis l'enchaînement de plusieurs semaines. L'inventaire initial comporte 36 fichiers de tests Node, dont 12 importent `node:child_process`, pour 329 tests. La suite initiale passe dans un environnement local nettoyé et sous un contexte extérieur contradictoire (semaines 2099, paramètres GitHub factices). Aucun second défaut identique d'héritage de semaine n'a été reproduit dans cette suite.

## Constat 1 — trois suites n'étaient pas inscrites dans le workflow principal

Le workflow `validate-architecture.yml` nommait explicitement 33 des 36 fichiers. Les trois absents totalisent 21 tests :

- `test-editorial-telerama-suggestions.mjs` ;
- `test-editorial-web-broadcast-policy.mjs` ;
- `test-replay-historical-editorial.mjs`.

Ils passent lorsqu'ils sont réellement exécutés. Il s'agit d'une lacune de couverture automatique, pas de 21 bugs découverts. La nouvelle étape du job obligatoire `data-and-policy` découvre automatiquement tous les fichiers `scripts/test-*.mjs` et `scripts/*.test.mjs`, sans supprimer les anciennes exécutions ni les validateurs éditoriaux, réseau et navigateur.

## Constat 2 — les deux déclarations de revue pouvaient diverger

Le helper `seal-editorial-review.mjs` écrivait seulement le drapeau historique `editorial_review_completed=true`. Si le checkpoint comportait déjà `editorial_review.completed=false`, cette valeur restait fausse, bien que le helper passe le checkpoint à `ready`. Le rapport donne la priorité à la déclaration moderne, alors que `reviewedCandidate` n'examinait que le drapeau historique.

Reproduction avant correction, sur des fixtures jetables : deux tests échouent (la clôture ne synchronise pas les déclarations ; le garde accepte la contradiction), deux protections existantes passent (absence d'acquiescement explicite et travaux restants empêchent la clôture).

Correction ciblée : la commande de clôture, toujours réservée à une revue expressément déclarée et à `remaining=[]`, met les deux déclarations en cohérence avec la même date, en conservant le contexte existant. Le garde de candidate refuse désormais une revue moderne explicitement incomplète, même si le drapeau historique vaut vrai. Les anciens checkpoints sans déclaration moderne restent compatibles. Les empreintes exactes des neuf livrables restent obligatoires.

Ce défaut est démontré sur une fixture. Il ne prouve ni qu'un numéro réel a été publié sans revue, ni qu'il était la cause de l'interruption de production de S43.

## Contrôle permanent de l'environnement

`node scripts/run-test-isolation.mjs` exécute quatre contextes : environnement isolé UTC, préparation S43 depuis America/Los_Angeles, validation de la première semaine 2027 depuis Pacific/Kiritimati, et semaines extérieures contradictoires en 2099 depuis Europe/Paris.

Chaque contexte doit exécuter la même suite non vide, sans test sauté, échec, signal ou erreur d'exécution. Les cinq fichiers de communication GitHub (`GITHUB_ENV`, `GITHUB_OUTPUT`, `GITHUB_STEP_SUMMARY`, `GITHUB_PATH`, `GITHUB_STATE`) sont remplacés par des sentinelles temporaires dont le contenu doit rester intact. Seul le contrôleur extérieur rédige le vrai résumé CI. Les identifiants sensibles et le contexte IPC interne du test runner ne sont pas hérités. L'empreinte des répertoires `scripts`, `data`, `assets`, `semaines`, `integrations` et `.github` doit rester inchangée.

Le contrôleur dispose lui-même de sept tests : nettoyage de l'environnement, découverte des fichiers, succès réellement exécuté, refus d'une assertion échouée, d'un test sauté, d'une pollution du résumé et d'une modification des sources.

Vérification par réintroduction locale de l'ancien défaut de #71 : l'ancien test S42, exécuté sous le contexte 2099, échoue et pollue la sentinelle du résumé. Le nouveau contrôleur le refuse. Cette mutation est faite uniquement dans un répertoire temporaire, jamais dans la branche distante.

## Douze cycles simulés, sans remise à zéro entre les trois semaines d'une séquence

Quatre séquences de trois cycles :

| Séquence | Semaines |
|---|---|
| Progression ordinaire | 2026-S42 → S43 → S44 |
| Changement d'année avec semaine ISO 53 | 2026-S53 → 2027-S01 → S02 |
| Passage à l'heure d'été | 2026-S13 → S14 → S15 |
| Passage à l'heure d'hiver | 2026-S44 → S45 → S46 |

Dans chaque séquence, le même dépôt Git temporaire conserve les numéros précédents. Les commandes réelles `next-target`, `editorial-handoff check/apply`, `validation-context`, `generation-report`, `seal-editorial-review` et `promote-week` sont exécutées. Les fonctions de garde et le watchdog utilisent des réponses de déploiement simulées.

Assertions : samedi-vendredi cohérent, même cible jeudi/vendredi/samedi, numéro public précédent préservé pendant le brouillon, import exact idempotent, refus de la candidate inachevée même avec un rapport synthétique sans écart, rejet du rapport hérité de la semaine précédente, impossibilité de sceller avec des travaux restants, invalidation des empreintes après une modification, promotion strictement limitée à deux fichiers et idempotente, et distinction entre promotion locale et déploiement effectivement vérifié par le watchdog.

Deux scénarios supplémentaires vérifient le refus d'un cycle manqué devenu périmé et la fenêtre de publication de Paris avant/après changement d'heure et au nouvel an. Un contrôle supplémentaire rouge, sauté ou indéterminé ne peut pas être assimilé à un succès par `checksPass`.

## Résultats locaux après correction

| Contexte | Fichiers Node | Tests réussis | Échecs / sautés | Fichiers GitHub pollués | Sources modifiées |
|---|---:|---:|---|---:|---|
| Isolé | 39 | 346/346 | 0 / 0 | 0 | Non |
| Préparation S43 | 39 | 346/346 | 0 / 0 | 0 | Non |
| Validation nouvel an | 39 | 346/346 | 0 / 0 | 0 | Non |
| Semaines contradictoires 2099 | 39 | 346/346 | 0 / 0 | 0 | Non |

Les deux suites Python passent également (12 + 7 tests). `validate-automation`, `validate-canonical-identities` et `sync-asset-versions --check` passent. `git diff --check` ne signale aucune erreur. Les 1 384 exécutions Node correspondent à 346 tests répétés dans quatre contextes, pas à 1 384 tests distincts.

## Limites

Ces contrôles renforcent le cycle technique et l'isolation. Ils ne vérifient pas des programmes TV futurs, les sources factuelles ou les critiques, les disponibilités, les quotas du planificateur, les droits d'écriture réels ni une publication Pages réelle de ces fixtures. Les déclarations de revue des tests sont exclusivement synthétiques. Ils ne terminent pas S43 et ne démontrent pas que son agent éditorial a repris. Les contrôles complets de données, d'images distantes, de rendu et de Jellyfin restent inchangés dans le workflow principal.
