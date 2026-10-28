# Sélection TV — automatisation hebdomadaire

## But

Le système doit produire chaque numéro du samedi au vendredi avec une qualité au moins équivalente aux numéros S40/S41, tout en appliquant les garde-fous plus stricts introduits à partir de S42.

L'automatisation est volontairement séparée en deux fonctions : le producteur éditorial est un agent de recherche disposant du Web et de GitHub ; le contrôleur/publicateur est GitHub Actions. GitHub Actions ne doit jamais inventer une sélection éditoriale à partir de données insuffisantes.

## Calendrier et cible

La cible est le prochain numéro commençant samedi et se terminant vendredi, calculé dans le fuseau Europe/Paris. La commande canonique est `node scripts/next-target.mjs`. Le samedi, la cible reste le samedi courant. Si un cycle a échoué, le cycle suivant saute les éditions non publiées devenues obsolètes : il produit la cible calendaire actuelle, sans rattrapage de programmes périmés. Les validateurs et la promotion appliquent cette même règle ; leurs logs nomment les cycles sautés. Les anciens brouillons restent non publics. Aucun seuil éditorial ne change.

La production démarre dès que le PDF Télérama du numéro est fourni au producteur. **La publication suit la validation, sans fenêtre horaire** : dès qu'une candidate scellée de la cible calendaire a tous ses contrôles verts, le publicateur protégé la fusionne, la revalidation post-fusion l'atteste, puis la PR de promotion la publie, quel que soit le jour (`review.mode: as-soon-as-validated`). Aucun contrôle, seuil ni attestation n'est allégé ; seule l'attente du vendredi disparaît. Le numéro publié en avance remplace le précédent sur l'accueil, qui reste consultable dans les archives.

Les cinq jalons du fuseau Europe/Paris deviennent des **échéances au plus tard** : inventaire jeudi 08:00, enrichissement vendredi 08:00, préflight vendredi 17:00, publication vendredi 20:00, puis retry samedi 08:00 si nécessaire. Ils restent la référence de la tâche de reprise horaire de secours (jeudi–samedi, 8 h–23 h Europe/Paris) ; les cinq anciennes tâches sont en pause. Chaque étape vérifie d'abord si la cible est déjà publiée et évite tout travail ou doublon inutile. La configuration machine-readable est data/automation-config.json.

## Candidate

Le producteur crée une branche exactement nommée auto/YYYY-Sxx et ne travaille jamais directement sur main.

Il construit au minimum :

- data/inventory/YYYY-Sxx.json ;
- data/coverage/YYYY-Sxx.json ;
- data/weeks/YYYY-Sxx.json ;
- data/radar-reserves/YYYY-Sxx.json ;
- semaines/YYYY-Sxx/index.html ;
- les enrichissements nécessaires dans data/works.json ;
- les liens exacts nécessaires dans data/links.json ;
- les changements réels de sorties/expirations dans data/releases.json ;
- l'entrée correspondante de data/manifest.json.

Pendant toute la PR candidate, l'entrée du manifeste reste status draft, le JSON hebdomadaire reste publication_status draft et manifest.latest reste le dernier numéro déjà publié. Une fusion prématurée ne remplace donc pas le numéro public.

## Inventaire avant sélection

La recherche est inventory-first. Pour chacun des sept jours, le producteur scanne 00:00–23:59, conserve aussi les programmes 00:00–05:59, inspecte toutes les chaînes minimales de data/editorial-config.json ainsi que les chaînes pertinentes découvertes, et enregistre au moins 30 candidats bruts à partir de S42.

La liste minimale concerne les chaînes actives. Paramount Channel/Paramount Network est retirée à partir de S42 après vérification de son arrêt définitif le 31 décembre 2025 ; la justification et le lien du compte officiel CANAL+ sont conservés dans `retired_channels` de `data/editorial-config.json`. Paramount+ reste une plateforme distincte. Une source temporairement indisponible ne justifie jamais de retirer une chaîne active.

Chaque ligne d'inventaire conserve title, start, channel, source et source_url. Chaque journée conserve source_pages, channels_scanned et channel_counts. Une simple liste de chaînes déclarées comme scannées ne remplace jamais les lignes de programmes.

Une seconde lecture des omissions et une passe de rappel éditoriale sont obligatoires. Sans PDF, comparer les grilles datées au relevé, avec un autre guide accessible et une revue explicite des omissions ; la provenance technique inconnue est consignée séparément. Avec ce PDF, sa grille fait autorité sur les faits imprimés et relus selon la règle ci-dessous ; son jugement critique ne doit pas être copié.

### Trois niveaux de vérification

1. **Inventaire large** : sept jours, chaînes requises et pertinentes, journées complètes et nuits 00:00–05:59, sources datées, comptes par chaîne et contradictions conservés. Chaque chaîne déclarée relevée l'est dans l'inventaire et dans `coverage.days[].channels_scanned`, avec sa grille lue et sa source.
2. **Rappel et arbitrage des grilles** : une seconde lecture, par jour et par chaîne du périmètre, recherche les omissions et consigne les écarts. Sans PDF fourni, elle compare réellement l’inventaire aux grilles complètes datées, avec un autre guide quand accessible ; une revue distincte de l’extraction couvre les omissions et les nuits même si une chaîne n’a qu’une grille complète accessible. La limite et les pages relues sont consignées ; sur le périmètre imprimé et relu d’un PDF Télérama fourni, la grille choisie par l’utilisateur fait autorité sans enquête obligatoire sur son fournisseur EPG. Elle ne transforme pas chaque horaire brut en enquête : elle n'exige pas de certifier individuellement les 2 000+ créneaux de l'inventaire. Deux agrégateurs qui partagent le même flux ne sont pas deux sources indépendantes ; si l’indépendance demeure inconnue, le noter précisément sans en faire seule une condition de publication. Une véritable lacune de couverture (chaîne, jour ou nuit non relus) reste bloquante.
3. **Propositions publiables** : pour chaque programme retenu, réserve, ligne de grille commentée et proposition de rubrique, vérifier réellement identité, version, diffusion (grille Télérama fournie et relue sur son périmètre, sinon preuve officielle exacte ou deux guides actuels d’éditeurs distincts concordants selon la règle Web ci-dessous), disponibilité/expiration, réception critique, métadonnées, liens exacts et visuel. Tous les champs de ce niveau restent requis ; la règle de preuve des quatre faits de grille est explicitement adaptée ci-dessous.

La politique opérationnelle de preuve et de clôture est détaillée dans `docs/EDITORIAL-CLOSURE-POLICY.md`. Le nom public du fournisseur EPG n’est pas une condition universelle : l’indépendance se justifie sur des preuves positives de provenance ou d’acquisition, avec sa portée et ses limites. Un éditeur, un domaine ou un distributeur différent ne suffit pas à la prouver. Une provenance inconnue reste inconnue ; elle ne vaut ni dépendance démontrée ni seconde source certifiée.

Une divergence d’horaire brut qui ne change ni l’identification, ni le rappel des omissions, ni une proposition publiée peut rester une note sourcée après revue d’impact. Une vraie lacune de chaîne, date ou nuit et un défaut d’une carte retenue ou de réserve restent bloquants. Une fenêtre EPG n’est pas une durée de copie ; sa différence avec la durée canonique ne démontre pas seule un montage différent, et la seule proximité ne démontre pas la version.

Les flags `primary_scan_complete`, `independent_crosscheck_complete`, `editorial_reminder_complete` et `full_week_reaudit_completed` se déclarent après revue des preuves de ces niveaux, jamais d'après des compteurs ni par simple report de représentation.

### Autorité du PDF Télérama fourni

Sur décision de l’utilisateur, le PDF correspondant à la cible est la référence du titre imprimé, de la chaîne, du jour et de l’heure des programmes qu’il couvre. Relire la transcription avec son empreinte, sa page et sa position ; conserver une preuve de cette revue, les données brutes et les écarts Web. Aucune seconde preuve de ces quatre faits ni enquête sur l’origine du flux EPG n’est requise pour accepter une ligne relue. Une correction officielle ultérieure précise, datée et portant sur le même programme peut modifier l’horaire : conserver l’annonce et le motif de l’écart.

La seconde lecture des omissions reste obligatoire : comparer réellement l’inventaire aux grilles imprimées et examiner les programmes/nuits manquants. Consigner les jours, chaînes, pages et lignes relus, les omissions traitées et les limites dans `coverage.grid_authority_reviews`. Une provenance EPG inconnue ne bloque plus à elle seule la clôture des faits de grille couverts par cette revue. Ne pas cocher `independent_crosscheck_complete` si l’indépendance est inconnue ; `full_week_reaudit_completed` peut être attesté après la revue globale réelle, avec cet arbitrage explicite sur le périmètre PDF et les preuves ordinaires hors PDF.

Le PDF n’autorise aucune clôture automatique : les fragments ambigus, chaînes/créneaux absents, première nuit non imprimée et autres lacunes restent à traiter. Le parseur relève par défaut les films/documentaires et ne prouve pas à lui seul l’exhaustivité de toutes les grilles. Identité canonique, version, durée de copie, replay/droits/expiration, réception critique, notes, liens et images gardent leurs contrôles. Sans PDF fourni pour la cible, appliquer le parcours Web complet ci-dessous, sans attendre de magazine.

### Inventaire de grille Télérama (à partir de `telerama_grid_authority_from_week`)

Sur décision de l’utilisateur, à partir de la semaine fixée par `quality_gates.telerama_grid_authority_from_week` (2026-S44), l’inventaire brut peut être la grille complète imprimée du PDF fourni (`mode: "telerama-grid-authority"`), au lieu d’un relevé Web. `scripts/editorial-telerama-grid-inventory.mjs` la construit depuis l’extraction `--scope all-programmes`. Chaque ligne cite l’empreinte du PDF enregistré sur `main` dans `data/editorial-inputs/YYYY-Sxx/telerama.json`, sa page et sa position ; les sources par jour et par chaîne sont des pages `sha256:EMPREINTE#page=N`. Aucune URL Web n’est inventée. Les seuils restent les mêmes : sept jours, chaînes obligatoires, 30 lignes par jour, une ligne de nuit, comptes par chaîne, pas de doublon. Seule la nature de la preuve change, et la règle des deux domaines par jour est remplacée, dans ce mode seulement, par la présence des pages du PDF. Des compléments Web ordinaires restent admis.

La seconde lecture devient une **revue de transcription par sondage**, consignée dans `coverage.grid_inventory.transcription_review`. Elle comprend au moins 7 pages relues en entier pour les omissions et au moins 35 lignes relues sur la page, dont 3 par jour, rattachées à l’inventaire. Chaque ligne relue reçoit la décision `matches`, `corrected` ou `added`, avec une note pour les deux dernières. La revue indique aussi sa date réelle, sa méthode et ses écarts. Les corrections et ajouts sont appliqués à l’inventaire lui-même ; une ligne ajoutée porte sa page et sa position. `full_week_reaudit_completed` ne s’atteste qu’après cette revue réelle.

Le magazine n’imprime pas tout. Mesure sur le numéro du 14 octobre 2026 (S43) : 3 441 lignes et 51 chaînes. L’écart habituel le plus long entre deux horaires imprimés d’une journée est d’environ 2 h 20 sur France 2 et 3 h sur TF1 et France 3. Il atteint 4 à 7 h sur ARTE, M6, France 4, France 5 et les chaînes Ciné+ et TCM Cinéma, à cause de longs blocs ou d’heures non imprimées. M6 n’a de nuit imprimée que 3 jours sur 7. La plupart des chaînes du câble ne sont imprimées qu’en soirée. Des films de nuit ou du matin des chaînes cinéma manquent : par exemple, aucun horaire imprimé sur TCM Cinéma entre 03:00 et 10:15 le 19 octobre, et le film de 06:33 de Ciné+ Festival n’est pas imprimé. Aucune chaîne n’est donc relevée comme complète. La portée mesurée par chaîne est consignée dans `coverage.grid_inventory.printed_scope` et `limits`. Les heures non imprimées sont hors du périmètre relevé : elles ne sont jamais présentées comme relevées et ne bloquent pas seules la clôture. Une piste identifiée hors de ce périmètre se vérifie par les preuves Web ordinaires.


### Parcours complet sans Télérama

À partir de S42, `web_schedule_evidence` admet deux voies pour le titre, la chaîne, la date et l’heure d’une proposition : une preuve officielle du même événement (pièces complémentaires reliées acceptées), ou deux guides actuels réellement lus, d’éditeurs distincts, concordant sur les quatre faits et le bon flux géographique. Un domaine distinct ne prouve ni un éditeur distinct ni l’indépendance. Un flux commun démontré compte une seule référence ; si l’origine technique est inconnue, consigner cette limite et parler de **recoupement concordant**, jamais d’indépendance établie. Cette modification de la règle de preuve évite une enquête amont sans fin ; elle ne garantit pas qu’une erreur commune aux guides serait détectée. Une correction officielle précise et datée prévaut. Une contradiction non résolue, une mauvaise version ou un événement non identifié impose résolution ou remplacement vérifié.

La couverture demande une seconde lecture réelle de chaque jour, chaîne et nuit : comparer le relevé avec les grilles complètes datées et rechercher les omissions. Employer un autre guide quand accessible ; si une chaîne n’a qu’une grille complète accessible, une lecture distincte de l’extraction peut comparer son contenu au relevé, avec cette limite consignée. Deux domaines par jour restent requis pour la diversité globale des sources ; ce contrôle ne certifie aucune indépendance. Sauvegarder dans `coverage.web_schedule_reviews` les dates/chaînes/flux/pages ou URLs, dates réelles de lecture, portée journée/nuit, comparaison effectuée, omissions et écarts examinés, décisions et limites. Une vraie partie de grille non lue ou une omission incertaine reste ouverte.

`independent_crosscheck_complete` reste faux lorsque l’indépendance n’est pas établie. `full_week_reaudit_completed` atteste l’audit global réellement achevé, selon cette méthode documentée, sans attendre le nom du fournisseur EPG. Le rappel éditorial s’appuie sur les critiques et découvertes disponibles ; ni une revue Télérama ni une note publique n’est indispensable. Identités, versions, offres/expirations, critique, images, liens, notes disponibles et seuils quantitatifs restent contrôlés. Le PDF conserve sa priorité lorsqu’il est fourni.

Après une tentative ciblée et une alternative distincte, choisir la voie de preuve disponible. Si une proposition reste insuffisante, préparer une alternative entièrement vérifiée pour le même emplacement puis remplacer cette proposition, plutôt que répéter les mêmes recherches. Une limitation de provenance seule peut devenir une note ; une véritable information nécessaire reste dans `remaining` jusqu’à résolution ou remplacement. Aucun outil ne coche ces flags, ne vide le suivi ni ne certifie le numéro automatiquement.

## Progression de la recherche et impasses

« Inventaire avant sélection » impose la prospection large des sept jours avant le choix final ; cela n'impose pas d'achever une fiche complète pour chaque entrée brute ni de résoudre chaque conflit avant de commencer l'enrichissement. Une fois le relevé primaire des sept jours et des chaînes actives effectué, approfondir les candidats prometteurs et leurs alternatives pendant que les recoupements de couverture encore nécessaires se poursuivent. Le stade `enrichment` peut donc conserver des tâches d'inventaire dans `remaining`. La certification finale des sept jours, la seconde lecture des omissions (arbitrage PDF fourni sur son périmètre, comparaison des grilles Web datées ailleurs), le rappel éditorial, la passe documentaire et tous les seuils restent obligatoires avant `ready`.

À chaque reprise, distinguer : exigences de couverture/publication encore manquantes ; champs à terminer pour les candidats prometteurs et leurs alternatives ; pistes non retenues ou impasses. Choisir une tâche utile qui peut progresser, plutôt que la première ligne `remaining` si elle attend une source absente. Après le relevé primaire, donner priorité à l'achèvement de dossiers déjà étayés et à leur sauvegarde dans les livrables autorisés, avant d'ajouter de nouvelles pistes. Le catalogue canonique n'accueille que les champs effectivement vérifiés ; les données hebdomadaires restent draft.

Après une tentative ciblée et une voie alternative distincte sans résultat exploitable, consigner dans un champ additionnel `research_attempts` de `data/research/YYYY-Sxx.json` : identifiant de tâche, objet/version/diffusion, question non résolue, sources exactes, dates réelles, résultat, caractère bloquant, statut, et condition concrète de reprise. Ne pas répéter les mêmes pages ou requêtes au passage suivant sans nouvelle source, modification observée ou contrôle de fraîcheur nécessaire. Ce mécanisme évite les répétitions ; il n'autorise ni à déduire la réponse ni à écourter les recherches critiques requises. Des observations déjà sauvegardées peuvent alimenter ce registre sans inventer une nouvelle consultation.

Une piste dont l'identité, la disponibilité ou l'intérêt restent insuffisamment étayés reste hors recommandations et réserves. Conserver sa preuve et sa limite dans coverage/research, avec une décision motivée. Une exclusion réellement examinée peut clore le travail sur cette piste ; une recherche simplement différée ne vaut pas exclusion ni vérification terminée. Toute impasse affectant une exigence de couverture, un seuil, un programme retenu ou une réserve reste dans `remaining` et bloque la publication jusqu'à résolution ou remplacement par une alternative entièrement vérifiée. Ne jamais retirer une chaîne active, déclarer `full_week_reaudit_completed` ou vider `remaining` pour contourner une source indisponible.

Les tentatives qui attendent un fait nouveau portent un `retry_gate` explicitement revu et lié aux textes exacts des actions. `editorial-research-triage.mjs` affiche séparément les actions accessibles, les attentes et les annotations à revoir, sans supprimer aucune exigence. Le contrôleur de la nouvelle révision donne priorité au prochain lot du passage courant et écarte des recommandations les seules attentes valides ; les anciens passages conservent leur politique. Une réouverture demande une preuve nouvelle datée, pas seulement une autre URL répondant à la même question sans résultat. Aucun registre historique ne certifie à lui seul que toutes les tâches de ce passage sont bloquées.

En mode passages, dans `run_metrics`, distinguer nouvelles pistes, dossiers incomplets suivis, fiches complètes et exigences de couverture résolues. Deux passages successifs après le relevé primaire sans fiche complète déclenchent une revue de priorité au passage suivant : expliquer la cause, choisir des dossiers proches de l'achèvement ou traiter leur blocage précis, sans recommencer la collecte générale. Aucun chiffre ne constitue une certification éditoriale ni une obligation de remplir avec un titre faible.

### Deux modes de conduite : session continue ou passages

Le même contrat s'applique dans deux modes de conduite de la production, déclarés par le champ `mode` de chaque entrée `run_metrics` : inventaire, preuves, seuils, validateurs, revue scellée, bail et chaîne de publication.

- **Session continue** (`mode: "session"`) : une seule session tient du début à la fin un clone local avec un shell Git et `gh` authentifié, par exemple Claude Code. Elle mène le numéro du PDF Télérama jusqu'à la remise de la candidate scellée au publicateur, puis suit la chaîne jusqu'au site public. C'est le mode normal de production depuis le 16 octobre 2026.
- **Passages** (entrée sans `mode`) : reprises de la tâche planifiée dans ChatGPT, de 50 minutes utiles, décrites dans « Enchaîner les lots pendant un passage » et `docs/EDITORIAL-AGENT-PROMPT.md`. Ce mode reste la voie de secours de la tâche horaire et peut reprendre un numéro laissé par une session.

#### Ce qu'une session continue ne fait pas

- Aucun budget de 55/50 minutes ni réserve de sauvegarde : la session continue jusqu'à la remise ou jusqu'à un vrai blocage.
- Aucune décision `editorial-continuation.mjs` après chaque checkpoint ni champ `continuation_decision(s)`.
- Aucune relecture des contrats à chaque passage ni trace `contract_reads` : la session lit les contrats une fois au début. Si `main` change pendant la session, elle relit seulement les blobs modifiés avant de synchroniser.
- Aucune sauvegarde distante toutes les dix minutes. La session commite localement à la fin de chaque phase ou lot cohérent, et n'écrit sur GitHub que par `push-candidate.mjs`, sous son bail court (`docs/CHAT-LEASE-PROTOCOL.md`). Avant un arrêt prévu sans remise (fin de journée, blocage), elle pousse le checkpoint de préparation de la même façon, pour que la reprise planifiée reparte de l'état réel.
- Aucun journal additionnel (`closure_decisions`, `remaining_history`, `documentary_pass_log`) : aucun outil ni validateur ne les lit, dans aucun mode. Une exigence se ferme par le livrable lui-même et sa preuve. `research_attempts` ne consigne que les impasses encore ouvertes à la fin de la session ; une impasse résolue ou remplacée pendant la session n'a pas besoin de registre.

Tout le reste est identique : inventaire avant sélection et revue de transcription, seconde lecture et rappel éditorial, passe documentaire et son bilan de couverture, enrichissement complet, seuils, `remaining` faisant autorité (vidé seulement exigence par exigence), validateurs locaux puis CI, revue scellée par `seal-editorial-review.mjs`, publicateur protégé et attestation. Des sous-agents de recherche en lecture seule sont permis ; un seul propriétaire écrit.

#### Une entrée `run_metrics` par session

`scripts/editorial-session.mjs` lit l'horloge à chaque transition. Aucune option ne permet de fournir une heure : les heures ne sont jamais reconstituées.

```sh
node scripts/editorial-session.mjs start 2026-S44
node scripts/editorial-session.mjs phase 2026-S44 import start
node scripts/editorial-session.mjs phase 2026-S44 import end --note "PR de sources fusionnée"
# … grid_inventory, shortlist, cards, sections, checks de la même façon
node scripts/editorial-session.mjs phase 2026-S44 publication_chain start
node scripts/seal-editorial-review.mjs 2026-S44 --review-completed
node scripts/editorial-session.mjs finish 2026-S44 --stop-reason ready_handed_off
git commit …   # puis
node scripts/push-candidate.mjs 2026-S44
```

| Phase | Ce qu'elle couvre |
|---|---|
| `import` | PDF vers `telerama.json` et `telerama-editorial.json`, lecture des critiques, PR de sources fusionnée |
| `grid_inventory` | inventaire de grille (relevé Web avant S44), revue de transcription, import du lot |
| `shortlist` | présélection par jour et par rubrique |
| `cards` | recherche et cartes des jours : choix, grilles commentées, réserves, passe documentaire |
| `sections` | rubriques hors grille : replay, plateformes, sorties, expirations, radars, sommaire, couverture |
| `checks` | validateurs locaux, revue navigateur, corrections |
| `publication_chain` | scellement, push, CI, fusion par le publicateur, revalidation, promotion, Pages, `latest.html` |

```json
{"mode": "session", "prompt_revision": "production-session-2026-10-16",
 "started_at": "2026-10-24T08:00:12.000Z", "ended_at": "2026-10-24T13:41:05.000Z", "run_state": "stopped",
 "duration_basis": "Horloge réelle relevée par scripts/editorial-session.mjs …",
 "phases": {"import": {"started_at": "…", "ended_at": "…"}, "…": {},
   "publication_chain": {"started_at": "…", "ended_at": null, "basis": "La chaîne protégée continue sur GitHub …"}},
 "deliverables_changed": ["data/weeks/2026-S44.json", "…"], "stop_reason": "ready_handed_off", "next_useful_batch": null}
```

- Les phases se suivent mais peuvent se chevaucher (sous-agents en parallèle) : leurs empans ne s'additionnent pas. Une phase reprise, par exemple `cards` après un contrôle, garde son premier début et note la reprise dans `reopened_at`. Une phase sans objet est sautée avec son motif (`skip … --reason`), par exemple un import déjà fusionné par une session précédente.
- Avant que le checkpoint de la semaine existe (import sur `main`), l'entrée attend dans un journal du répertoire Git (`selection-tv-session-YYYY-Sxx.json`, jamais commité). Elle passe dans `run_metrics` à la première commande qui trouve `data/research/YYYY-Sxx.json`.
- `ended_at` est la remise, c'est-à-dire le dernier commit de la candidate. La chaîne de publication continue ensuite sur GitHub : `publication_chain.ended_at` reste `null` avec son motif dans `basis`. La fin constatée sur `latest.html` figure dans le compte rendu de la session, et les horodatages des exécutions GitHub en gardent la trace.
- `finish --stop-reason ready_handed_off` exige toutes les autres phases terminées ou sautées et la chaîne commencée. Un arrêt avant la remise exige `--next` (le prochain lot utile) et ferme les phases en cours à l'heure réelle de l'arrêt. `deliverables_changed` est calculé depuis Git (base `origin/main`), ou fourni par `--deliverables`.
- Si la CI de la candidate échoue après la remise, la même session exécute `resume`, rouvre `checks`, corrige, puis `finish` de nouveau.
- Une session interrompue sans bilan reste `running`. La session suivante démarre avec `start --supersede`, qui la marque `interrupted_unobserved` sans lui inventer de fin. Une reprise planifiée ajoute sa propre entrée de passage.
- `node scripts/editorial-session.mjs check YYYY-Sxx` et le rapport `preparation-gaps` auditent cette entrée par phase, à titre informatif. L'audit des passages (décision de poursuite, seuil de 50 minutes) ne s'applique pas à une entrée de session.

#### Preuves compactes

En session, chaque preuve nouvelle est un enregistrement de `verification_records` qui énonce un fait, sans prose :

```json
{"work_id": "le-pont-de-la-riviere-kwai-1957", "url": "https://www.arte.tv/fr/guide/2026-10-18/",
 "checked_at": "2026-10-15T10:27:11Z", "field": "broadcast.start", "result": "verified", "value": "13:30",
 "applies_to": {"date": "2026-10-18", "channel": "Arte", "start": "13:30"}}
```

- `url` : la page réellement lue, ou `sha256:EMPREINTE#page=N` pour une page du PDF fourni ; jamais une page de résultats de recherche.
- `checked_at` : l'heure réelle de la lecture.
- `field` : le fait vérifié, par exemple `director`, `year`, `duration`, `broadcast.start`, `offer.expires`, `ratings.imdb`, `image` ou `critique`.
- `result` : `verified`, `corrected`, `contradicted`, `unavailable` ou `not_found`. Pour `corrected` et `contradicted`, `value` donne la valeur observée.
- Sujet : `work_id` si l'identité est certaine, sinon `title`, ou `applies_to` (date, chaîne, heure) pour une grille.
- Facultatifs : `value` (300 caractères au plus), `note` (280 caractères au plus, seulement ce que les champs ne disent pas) et `stability` (`stable` par défaut pour les champs d'identité, `cycle_specific` sinon).

Un enregistrement porte un fait et une source : deux guides concordants font deux enregistrements. `editorial-production-plan.mjs` et `editorial-work-packet.mjs` les lisent comme les enregistrements historiques, qui restent valides. Les dossiers en prose (`research_dossiers`) ne sont plus nécessaires : les faits vont dans ces enregistrements, la décision dans `shortlist.entries` (statut, `decision_note`), l'argument critique dans la carte et, pour un documentaire, dans le bilan de couverture exigé plus bas. Sur le parcours Web, `coverage.web_schedule_reviews` prend la même forme : une ligne par date et chaîne avec `url`, `checked_at`, `segment` (journée, nuit), `compared_with`, `omissions` (liste) et `result`, plus une `limit` courte si nécessaire. `preparation-gaps` et `editorial-session.mjs check` signalent un enregistrement compact mal formé ; ce signalement est informatif et ne change aucune barrière de publication.

#### Kit de production : l'enchaînement par commandes du dépôt

Les étapes d'aide d'une session continue, menées à la main pendant S44 et S45, sont des commandes du dépôt : `scripts/editorial-kit.mjs` (Node) et `scripts/editorial-telerama-kit.py` (lecture du PDF). Elles ne connaissent aucune semaine : dates, empreinte du PDF, numéro Télérama et SHA des sources viennent de l'identifiant de semaine, des fichiers enregistrés sur la branche et de `production.json`. Les textes (synopsis, justifications, en-têtes, motifs de rejet, notes de critique) restent des fichiers JSON d'entrée écrits par le producteur dans un **dossier de travail** hors du dépôt (`W`, dans le scratchpad), dont la structure et les formats sont décrits dans `docs/EDITORIAL-KIT.md`.

Chaque commande lit les sources de la semaine et `W`, affiche un rapport JSON et n'écrit dans le dépôt qu'avec `--write`. Les plans de cartes sont construits depuis un commit (`--ref`, `HEAD` par défaut) : la commande refuse de travailler si `data/works.json` diffère de ce commit, car `editorial-draft-cards.mjs` ne verrait pas l'édition. Un rapport qui signale des problèmes sort avec un code non nul.

| Étape (phase `run_metrics`) | Commande | Produit |
|---|---|---|
| Import (`import`) | `python scripts/prepare-telerama-input.py PDF --out-dir W/import` puis `python scripts/editorial-telerama-kit.py grid-samples --pdf PDF --report W/import/telerama.json --out-dir W/grid-review` | extraction, planches de trois lignes par page pour `import_review` |
| | `node scripts/editorial-kit.mjs review-notes YYYY-Sxx --work W` | `W/import/telerama-editorial.json` complété par `W/review-notes.json` (auteur, résumé relu, titre corrigé), brut gardé en `.raw.json` ; puis PR de sources |
| Checkpoint | `node scripts/editorial-kit.mjs init YYYY-Sxx --write` | `data/research/YYYY-Sxx.json` (étape `inventory`, `remaining` de la semaine) ; refusé s'il existe déjà |
| Grille (`grid_inventory`) | `editorial-telerama-grid-inventory.mjs` (inchangé), puis `node scripts/editorial-kit.mjs grid-review YYYY-Sxx --work W --write` | corrections et ajouts de `W/grid-review.json` appliqués à l'inventaire, `transcription_review` ; refusé tant que les seuils de revue ne sont pas atteints |
| Présélection (`shortlist`) | `python scripts/editorial-telerama-kit.py grid-ratings --pdf PDF --report …/telerama.json --out W/grid-ratings.json`, `node scripts/editorial-kit.mjs candidates YYYY-Sxx --work W` | `W/out/candidates.txt` : titres classés par appréciation native, publication récente (fraîcheur) et fiche existante |
| | `python scripts/editorial-telerama-kit.py printed --pdf PDF --report …/telerama.json --picks W/picks.json --out W/printed.json` | lignes imprimées des choix, données aux sous-agents de recherche (dossiers dans `W/dossiers/`) |
| Cartes (`cards`) | `node scripts/editorial-kit.mjs catalogue YYYY-Sxx --work W --write` (choix) ou `--dossier RAD.json --keys hd,hd_reserve` (rubriques) | `W/out/works-plan.json`, œuvres nouvelles et liens exacts manquants dans `data/works.json`, commandes des résolveurs |
| | `work-resolver.mjs --report R` puis `--apply`, `node scripts/editorial-kit.mjs fill-fields YYYY-Sxx --work W --report R --write`, `poster-resolver.mjs`, commit | champs laissés en conflit remplis depuis la page exacte ; champs encore manquants listés |
| | `node scripts/editorial-kit.mjs day-plan YYYY-Sxx --work W [--days samedi,…] [--replace]` | `W/out/plan-days.json` |
| | `node scripts/editorial-kit.mjs render YYYY-Sxx --work W --plan out/plan-days.json`, `editorial-handoff.mjs check` puis `apply`, `poster-copy.mjs --week YYYY-Sxx`, commit | paquet au nom nouveau à chaque rendu |
| Rubriques (`sections`) | `node scripts/editorial-kit.mjs section-plan YYYY-Sxx --work W --spec sections/radar-hd.json [--replace]`, puis `render`, `apply`, `poster-copy`, commit | rendez-vous, replay, plateformes, sorties, expirations, radars, couverture et sommaire |
| Preuves (`checks`) | `node scripts/editorial-kit.mjs shortlist YYYY-Sxx --work W --write` puis `coverage-pass YYYY-Sxx --work W --write` | `shortlist.entries` et `verification_records` compacts ; `documentary_pass` et `editorial_reminder` du bilan de couverture |

Les pièges des sessions S44 et S45 sont intégrés aux commandes :

- une critique Télérama se rattache à une carte par date, heure et titre, sinon par date, heure et chaîne quand le titre officiel diffère du titre imprimé, sinon par date, chaîne et titre quand l'en-tête de la critique et la grille impriment deux heures différentes ; une œuvre sans créneau n'emprunte jamais une critique sur son seul titre ;
- un créneau se rapproche de l'inventaire par heure, chaîne et titre imprimé ou officiel ; quand le titre de la fiche est en version originale, la ligne unique de l'inventaire à cette heure et sur cette chaîne fait foi. Un créneau absent de l'inventaire exige une preuve écrite (`review.current_broadcast`) ;
- une fiche dont l'affiche est déjà copiée dans `assets/posters` est rendue avec `work.image` distante (`image_remote`) ; `poster-copy.mjs --week` doit être relancé après chaque `apply`, avant le scellement ;
- une page rendez-vous ou sorties physiques porte sa cible plus la réserve minimale de `data/personalization-config.json` (soit dix cartes par page rendez-vous) ; la commande refuse un plan plus court ;
- une œuvre n'est reprise du catalogue que par un lien exact ou par titre et année ; un homonyme sur le seul titre est signalé (`clash`), jamais réutilisé. Deux dossiers de la même rubrique pour une même œuvre doivent être départagés en nommant le fichier ;
- `render` écrit un nouveau paquet à chaque appel : un ancien paquet ne peut plus être appliqué par erreur après un rendu refusé ;
- le parseur des critiques (`editorial-telerama-editorial.py`) coupe l'en-tête et le titre d'une critique au premier blanc large et reconnaît aussi les genres « Divertissement » et « Doc » : les critiques perdues ou faussées en S45 (trois) et en S44 (deux) sont extraites sans ajout manuel ; `review-notes.json` remplace le script de relecture recopié de session en session ;
- les cartes de radar dont le texte visible dépasse `radar_card_max_chars` (500 par défaut) et une profondeur HD ou popularité inférieure aux minimums de configuration sont signalées avant le rendu.

Le kit ne choisit, ne classe ni ne rédige rien : il ne coche aucun flag, ne vide jamais `remaining`, ne scelle ni ne publie. Les validateurs, la revue scellée, `push-candidate.mjs` et la chaîne de publication protégée restent identiques. Tests : `node --test scripts/test-editorial-kit.mjs`, `python3 scripts/test-editorial-telerama-kit.py`.

### Enchaîner les lots pendant un passage

Cette section s'applique au mode passages ; une session continue suit « Deux modes de conduite » ci-dessus.

La cadence horaire est un filet de reprise, pas un quota d'un lot par exécution. La révision `production-web-evidence-2026-10-09`, comme les précédentes `production-telerama-first-suggestions-2026-10-09`, `production-telerama-authority-2026-10-09`, `production-proof-policy-2026-10-09`, `production-closure-2026-10-09`, `production-telerama-editorial-2026-10-09`, `production-telerama-optional-2026-10-09`, `production-dataflow-2026-10-09`, `production-integrity-2026-10-09` et `production-efficiency-2026-10-09`, utilise une durée cible de 55 minutes de temps écoulé observé, dont cinq minutes réservées à la dernière sauvegarde et à la libération du bail (50 minutes utiles). C'est une convention de travail à mesurer, pas une limite de la plateforme ni une mesure de quota. La révision historique `production-continuation-2026-10-09` utilisait35minutes ; ses observations restent auditées selon ce plafond, sans réécriture des faits. Sauvegarder régulièrement, puis continuer immédiatement sur le prochain lot utile tant que le temps restant, les outils et le bail permettent le travail et une sauvegarde finale sûre. Renouveler le bail après20minutes selon le protocole existant. Une sauvegarde, un dossier achevé, un changement de phase ou un contrôle CI en cours ne sont pas, à eux seuls, des motifs d'arrêt. Éviter les attentes répétées : pendant un contrôle, poursuivre les recherches indépendantes qui peuvent progresser, en gardant la validation finale liée au SHA exact.

Pour un candidat déjà documenté, enchaîner la création de sa fiche draft (identité canonique, champs sourcés, textes, liens et visuel), sa revue et sa sauvegarde dès que les preuves le permettent ; ne pas repousser mécaniquement cette intégration au passage suivant. Un dossier de recherche complet n'est pas compté comme une carte complète. Continuer ensuite avec un autre candidat ou une rubrique ; les étapes déjà achevées restent réutilisées.

Terminer quand le budget utile touche à sa fin, que les outils ou l'exécution sont interrompus, que le bail est perdu/expiré, que toutes les tâches accessibles attendent une dépendance réelle, ou que le numéro est prêt et remis au publicateur. Ne jamais poursuivre sans bail ni contourner une permission. Si possible avant l'arrêt, sauvegarder le travail et enregistrer dans le dernier `run_metrics` : `prompt_revision`, `started_at` et `ended_at` réellement connus (sinon `null` avec `duration_basis` expliquant pourquoi), `completed_batches`, `deliverables_changed`, un `stop_reason` précis et `next_useful_batch` ; si une interruption empêche cette écriture, la reprise doit l'indiquer comme inconnue, sans inventer sa cause ou sa durée. Ne pas attendre pour atteindre artificiellement55minutes. La durée visée ne garantit ni durée réelle d'exécution ni quota disponible.

À partir de la consigne `production-continuation-2026-10-09`, prendre une décision explicite au début du passage et après chaque checkpoint avec `scripts/editorial-continuation.mjs`. Fournir l'heure de début réellement capturée pour cette exécution, l'heure courante et la propriété/expiration du bail réellement relues. Ne pas utiliser l'heure de début d'un passage précédent. L'outil est en lecture seule et rend `continue`, `stop` ou `unknown`, avec les observations et prochaines actions du checkpoint. `continue` impose de commencer immédiatement l'action utile suivante ; une tâche bloquée mène à une autre tâche accessible. `unknown` impose de vérifier l'information manquante, sans inventer une limite ni conclure que tout est bloqué. Une perte de bail ou une interruption réellement observée prévaut sur la poursuite.

Exemple depuis un clone possédant la candidate : `node scripts/editorial-continuation.mjs YYYY-Sxx --ref SHA_CANDIDATE --started-at DEBUT_REEL_ISO --lease-owned yes --lease-until EXPIRATION_RELUE_ISO`. Pour déclarer la fin du passage, ajouter `--finish` avant la sauvegarde finale et la libération : un code 2 indique que la poursuite ou la vérification d'une information reste nécessaire ; seul un arrêt étayé rend 0. Cette commande contrôle une fin de passage, jamais la publication ni une limite de plateforme. La décision est une aide à la conduite du passage, jamais une sélection éditoriale, une certification de `ready` ou un renouvellement automatique du bail. Conserver les décisions observées dans `run_metrics[].continuation_decisions` et la décision terminale dans `continuation_decision`, avec `run_state` (`running` au checkpoint intermédiaire, `stopped` au bilan terminal), le motif réel et les limites de mesure. Une interruption empêchant ce bilan reste inconnue.

Le rapport `preparation-gaps` signale désormais les arrêts documentés par une simple fin de lot et les décisions terminales insuffisamment justifiées. Ce signalement est informatif : il ne crée aucune nouvelle exigence de publication et ne modifie pas les anciens faits. Son absence ne prouve ni efficacité ni vérité d'une déclaration. L'agent peut encore être interrompu par la plateforme ; l'outil ne peut ni empêcher une interruption ni forcer une nouvelle exécution.

### Paquet de travail ciblé

Avant de relire les checkpoints complets, utiliser `node scripts/editorial-work-packet.mjs YYYY-Sxx --ref SHA_CANDIDATE` depuis un clone disposant du commit courant. L'outil lit une seule révision Git immuable, ne modifie aucun fichier et affiche l'état des livrables, les exigences ouvertes, les dossiers effectivement recherchés, les impasses et des correspondances de titre avec le catalogue. La liste des correspondances est alphabétique et paginée (`--limit 1..40 --offset N`) ; elle ne constitue ni classement artistique ni sélection. Des données présentes dans le catalogue ne deviennent pas vérifiées par cette extraction. L'exposition dans les numéros précédents est un avertissement pour la fraîcheur, jamais une sélection automatique.

`--compact` réduit le JSON et retire seulement la liste globale des exigences, en conservant leur nombre et un avertissement : lire le checkpoint complet avant certification. Les preuves ciblées restent présentes. Les preuves de grille par chaîne/date sont séparées des preuves d'identité ; une impasse sur un épisode ou une diffusion ne masque pas toutes les occurrences du titre.

Pour un dossier choisi, utiliser `--title "Titre exact"` : le paquet rassemble les entrées canoniques possibles, liens centraux, diffusions brutes, dossier critique, tentatives et vérifications enregistrées. Les dates de consultation, statuts de conflit/indisponibilité, versions et limites sont conservés. Les homonymes/remakes restent séparés et les absences restent visibles. Examiner les preuves ainsi regroupées, rechercher seulement les informations manquantes ou périssables, puis intégrer les champs réellement vérifiés et rédiger la fiche draft. Ne jamais utiliser une correspondance de titre seule pour réutiliser l'identité, une note ancienne ou une disponibilité.

Pour plusieurs dossiers choisis, répéter `--title` dans une commande (jusqu'à huit titres). Les fichiers Git sont lus une fois au même SHA et le contexte global est affiché une fois ; les preuves, identités possibles et avertissements historiques restent distincts pour chaque œuvre. Le mode un titre conserve son format. Cette extraction ne remplace aucune vérification des faits.

Le paquet n'atteste jamais `ready`, ne choisit pas les programmes, ne remplit pas de textes et ne scelle pas la revue. Si le shell/Git n'est pas disponible, effectuer la même extraction ciblée avec les outils connectés en conservant le SHA et toutes les limites ; ne pas prétendre avoir exécuté le helper. La petite vue de travail réduit les lectures répétées, pas les critères. Refaire l'extraction après un changement du checkpoint pertinent.

### Présélection révisable

Après le relevé primaire, constituer dans `data/research/YYYY-Sxx.json` une présélection `shortlist.entries` par jour (`scope.day`) et par rubrique (`scope.rubrique`, par exemple `replay-1`, `plateformes-abonnement`, `radar-1`). Chaque piste conservée porte au moins un signal éditorial vérifiable et sourcé (`signals[]` : `kind`, `note`, `source_url`, ou référence papier Télérama structurée ci-dessous) : critique argumentée, distinction précise, auteur, importance patrimoniale, rareté de diffusion, disponibilité nouvelle. Statuts : `to_research`, `researching`, `dossier_complete`, `card_drafted`, `card_complete`, `rejected`, `deferred` ; un rejet ou un report porte `decision_note`. `alternatives` relie les pistes de remplacement.

À partir de S43, `initial_suggestions` dans la configuration donne au complément éditorial Télérama fourni pour la cible l’autorité sur les premières pistes : examiner `initial_editorial_suggestions`, Bravo (TTTT), Très bien (TTT), puis Bien (TT). Avant toute shortlist enregistrée, les pistes positives rapprochées sont prioritaires dans la file ; ensuite les décisions sauvegardées et l’ordre de production restent applicables. Les critiques non rapprochées restent des investigations sans identité héritée. Bof/Hélas sont des avis réservés attribués, pas des amorces positives ni des exclusions automatiques. Les autres sources complètent et équilibrent les jours, rubriques et découvertes, ou remplacent une piste insuffisante. Aucune appréciation n’est transformée en note externe, consensus ou carte complète. Sans magazine, le parcours actuel continue.

Un avis papier peut sourcer une piste sans URL inventée : le signal porte `kind`, `note`, `publisher: "Télérama"`, `source_ref: "sha256:EMPREINTE_PDF"`, `pdf_page`, `bbox` et `provenance` (`source_sha` Git exact, `path: "data/editorial-inputs/YYYY-Sxx/telerama-editorial.json"`, `json_pointer: "/reviews/INDEX"`). Vérifier que l’avis, sa page et son empreinte correspondent à l’entrée importée ; une référence structurellement valide ne certifie ni lecture ni sélection. Ne pas fabriquer de provenance Git pour un rapport seulement local. S42 conserve ses choix en cours ; une importation ultérieure ne rouvre pas une shortlist ou un rejet sans revue motivée.

La présélection oriente l'approfondissement : rechercher en priorité ses pistes, ne pas reconsidérer tout l'inventaire à chaque passage, la réviser seulement sur un fait nouveau ou si elle s'épuise. Viser environ une fois et demie à deux fois le nombre de positions à pourvoir, sans jamais ajouter un titre faible pour atteindre un nombre. Elle n'est ni une sélection publiée ni une personnalisation ; une œuvre peut alimenter plusieurs emplacements (choix développé, grille, réserve) sans nouvelle recherche, dans le respect de la déduplication et de la fraîcheur.

Travailler ensuite par lots cohérents : `editorial-work-packet.mjs --title` pour réunir les preuves, recherche des seuls champs manquants ou périssables, rédaction, rendu des cartes avec `editorial-draft-cards.mjs`, contrôle du paquet, sauvegarde sous bail, mise à jour du statut de la piste. Les rubriques indépendantes des grilles TV (plateformes, sorties, radars) avancent en parallèle des journées.

### Réduire les reprises de lecture et de contrôle

Au début du passage, lire un rapport d'écarts correspondant à la tête/base courante ou l'exécuter une fois. Préparer quelques dossiers proches d'une carte (en général trois à six, sans quota), avec leurs champs manquants, périssables ou contradictoires. Regrouper les consultations indépendantes quand les outils le permettent et poursuivre les œuvres accessibles pendant qu'une piste attend une source. Ne pas rouvrir les contrats inchangés, les preuves stables déjà relues ni une impasse sans fait nouveau ; les dates originales et l'identité/version restent conservées.

Fournir un seul plan de plusieurs cartes revues à l'outil de brouillon, incluant si prêts plusieurs jours, rubriques ou réserves. Conserver les pools complets existants lors de leur remplacement. Réutiliser une même preuve stable dans plusieurs emplacements seulement après confirmation de l'identité et de sa portée ; vérifier les diffusions/offres propres au cycle. En mode passages, sauvegarder un lot cohérent ou les preuves partielles réellement obtenues environ toutes les dix minutes, avec un statut exact ; en session continue, commiter localement à la fin de chaque phase ou lot.

Contrôler après modification les données, textes, liens, fraîcheur et pages concernés. Les tests de l'outillage ne sont pas à rejouer après chaque carte si le code n'a pas changé. Un contrôle identique sur les mêmes fichiers/paramètres n'est relancé qu'après changement, échec ou incertitude. Actualiser le rapport d'écarts après un lot qui modifie les livrables, pas avant chaque choix de titre ni après une simple écriture de métrique. Un rapport ancien n'oriente que le travail et ne certifie pas la nouvelle tête. Les contrôles complets sur le SHA/base final, images/navigateur/Jellyfin compris, restent obligatoires avant publication.

La délégation disponible peut paralléliser recherches et revues indépendantes en lecture seule ; un seul propriétaire du bail intègre et écrit sur la candidate. Mesurer, quand les observations le permettent, les intervalles de reprise/extraction, recherche, rédaction/rendu, contrôles, sauvegarde et attente, ainsi que les cartes/réserves/rubriques intégrées et exigences closes. Des temps inconnus restent inconnus ; les tâches parallèles ne sont pas additionnées comme des temps séquentiels. Le nombre de commits ne mesure pas le travail éditorial achevé.

### Écarts avant ready

`remaining` reste le tableau de chaînes de caractères faisant autorité. Un champ voisin facultatif `remaining_items` peut décrire chaque exigence : `id`, `text` (identique à une ligne de `remaining`), `scope` (`kind` parmi global, coverage, day, rubrique, deliverable, candidate, et `value`), `blocking` et `closes_when`. `validation-context.mjs` refuse un `remaining_items` qui perdrait ou ajouterait une exigence.

`node scripts/preparation-gaps.mjs YYYY-Sxx --json FICHIER` exécute sur un clone de la candidate les validateurs de candidate existants et classe leurs écarts par jour, rubrique, couverture et livrable. En préparation, la CI publie le même rapport dans le résumé et l'artefact `preparation-gaps-YYYY-Sxx`. Ce rapport est **informatif et non certifiant** : un écart absent ne vaut ni vérification ni autorisation ; la barrière `--require-ready` et les contrôles complets restent obligatoires.

## Intégrité des sauvegardes et profondeur des réserves

Avant une écriture distante, contrôler le JSON exact destiné au transport et les identifiants de la présélection. Conserver les fichiers complets et les manipuler programmatiquement ; aucune sortie de consultation, tronquée ou non, ne sert à reconstruire manuellement un checkpoint. Vérifier les empreintes des blobs créés avant de déplacer la référence. Le transport mécanique du handoff préserve le contenu sans le recopier dans une réponse.

Les réserves HD se comptent sur les œuvres distinctes de l’ensemble des deux pages, avec des alternatives absentes de tous les choix visibles. Les réserves de popularité sont distinctes des choix principaux et de la page de sillonnage. Des références croisées aux primaires ne remplacent pas des réserves supplémentaires. Les exceptions de pénurie existantes conservent leurs conditions et leurs preuves. Ces contrôles s’appliquent au contrat strict S42 et suivants ; les archives gardent leur politique historique.

## Prospection documentaire et exigence critique

À partir de S42, appliquer `documentary_discovery` dans `data/editorial-config.json`. Le producteur effectue une passe dédiée Arte, France 5, France 2/3/4 et france.tv, puis TV5MONDE et les autres sources pertinentes. Examiner grille, replay, disponibilité anticipée, exclusivités numériques et départs prochains : une lecture des seules grilles cinéma ne suffit pas. Couvrir aussi bien les documentaires de création que l’histoire, les archives, les arts, les sciences et les enquêtes. Ne pas assimiler automatiquement une fiction historique ou un magazine récurrent à un documentaire recommandable.

Pour chaque recommandation documentaire et réserve, consigner dans le bilan de couverture les preuves de l’intérêt propre du film : critique indépendante argumentée (à privilégier), réception contradictoire éventuelle, distinction ou sélection précisément identifiée, démarche et matériaux vérifiables. Un résumé promotionnel, une chaîne reconnue ou un sujet important ne prouvent pas la qualité du traitement. Ne pas inventer de consensus à partir d’une seule critique, ni traiter deux reprises de la même dépêche comme deux avis indépendants.

L’absence de note IMDb/SensCritique ne disqualifie pas à elle seule un documentaire télévisé. Rechercher sa réception, tracer les sources, puis distinguer réception établie et découverte motivée aux preuves plus limitées. Les notes disponibles restent renseignées avec leurs sources ; les motifs d’absence respectent les contrôles existants. Un film dont l’intérêt reste insuffisamment étayé n’est pas publié pour remplir le numéro.

Garder une dominante cinéma sans imposer un quota chiffré ni exclure un documentaire exceptionnel. Les trois choix quotidiens développés restent hiérarchisés ; les autres propositions fortes enrichissent les grilles commentées, le replay et les réserves complètes. Viser les quinze candidats complets prévus lorsque l’offre le permet. Dédupliquer les œuvres, rediffusions et collections entre rubriques ; vérifier le bilan des principaux, des compléments et des réserves séparément pour éviter une surreprésentation masquée.

La passe doit laisser une trace dans `data/coverage/YYYY-Sxx.json` : diffuseurs/offres consultés et pages exactes, candidats documentaires examinés, décision et justification sourcée, limites de collecte, répartition des œuvres distinctes. Une semaine pauvre en propositions fortes doit être expliquée, jamais compensée par des titres faibles ou des preuves fictives. Ce bilan est une exigence de recherche et de revue éditoriale ; le CI ne certifie pas la valeur artistique ni la véracité des critiques.

## Enrichissement

Tout programme retenu, y compris une réserve ou une ligne de grille commentée, doit être prêt pour le Web et Fire TV.

Il faut vérifier : work_id, titre, aliases utiles, réalisateur ou créateur, année, pays, durée, genre, synopsis informatif, justification éditoriale propre, chaîne, horaire, affiche réelle, image_source_url, image_checked, fallbacks utiles, notes vérifiables et au moins une identité forte directe IMDb/TMDb/SensCritique/AlloCiné ou page officielle propre à l'œuvre.

Aucune URL de résultats de recherche n'est admise et aucune donnée manquante ne doit être remplacée par une information seulement plausible.

## Hiérarchie et réserves

Chaque jour comporte normalement trois choix développés, au moins dix candidats complets au total et un objectif de quinze. Les rangs 4+ sont des recommandations complètes capables de remplacer immédiatement un programme déjà vu.

Une pénurie n'est admise qu'avec un shortage_reason structuré et sourcé. La fraîcheur inter-numéros est contrôlée par validate-freshness.mjs.

Les autres rubriques respectent data/editorial-config.json et data/personalization-config.json : rendez-vous, replay, plateformes, sorties, expirations, radar de popularité et radar 1080p. Aucun quota ne justifie une recommandation faible.

## Validation de la candidate

Les checkpoints `inventory` et `enrichment` sont contrôlés par `scripts/validation-context.mjs` : identités, dates, sources, compteurs et invariants de non-publication. Leur `remaining` décrit le travail inachevé. Les tests éditoriaux et navigateur continuent de vérifier le dernier numéro publié ; le contrôle obligatoire `data-and-policy` échoue explicitement en fin de parcours tant que la préparation n’est pas achevée. Un résultat navigateur vert à ce stade ne valide pas S42 et ne permet jamais sa fusion.

Lorsque le checkpoint est `ready`, avec revue achevée, `remaining` vide et empreintes exactes de tous les livrables, la PR auto/YYYY-Sxx est testée explicitement via SELECTION_TV_VALIDATE_WEEK et SELECTION_TV_CANDIDATE. Un ancien candidat sans checkpoint reçoit aussi tous les contrôles, sans traitement de préparation. Le brouillon est rendu par Chromium via preview=1, mais issue-loader.js n'autorise ce preview que sur localhost/127.0.0.1.

Les contrôles couvrent : architecture, contrat d'automatisation, contrat de candidate, éditorial, liens exacts, fraîcheur, réserves, santé distante des images, rendu desktop/responsive/print et modèle tv=1 de Fire TV.

## Fusion et promotion

La PR auto/YYYY-Sxx ne doit être fusionnée que lorsque les contrôles obligatoires sont verts.

Après fusion de la PR auto/YYYY-Sxx, la semaine est encore un brouillon sur main. Le workflow promote-validated-week.yml reprend alors la semaine depuis le nom de branche, rejoue les validations, reteste les images distantes, Chromium, Jellyfin Web et le modèle Fire TV, puis simule localement scripts/promote-week.mjs. Ce workflow ne pousse plus rien sur main.

La revalidation réussie publie un artefact promotion-ready lié au SHA exact de main et à la semaine. La PR de promotion exige cet artefact pour son SHA de base ; si main a changé, relancer promote-validated-week.yml via workflow_dispatch avec la semaine cible.

Si cette revalidation post-fusion est verte, le producteur crée une seconde branche promote/YYYY-Sxx depuis le main courant. Cette branche ne modifie que data/manifest.json et data/weeks/YYYY-Sxx.json selon la transition atomique produite par promote-week.mjs : manifest.latest devient YYYY-Sxx, le statut de l'entrée passe à published et publication_status passe à published. Une seconde PR vers main est alors ouverte. Elle doit elle aussi passer les contrôles obligatoires avant fusion.

Ainsi, même la promotion finale respecte la protection native de main : aucun bypass n'est nécessaire. Si un contrôle échoue à l'une des deux étapes, l'ancien numéro reste public.

guard-direct-publication.yml constitue une défense supplémentaire : il accepte seulement une transition exacte de deux fichiers, draft vers published, et traite toute autre modification de manifest.latest comme non conforme. Le contrôle bloquant est exécuté avant fusion dans data-and-policy. Le garde-fou après push alerte et échoue ; il ne tente aucun push de restauration incompatible avec la ruleset.

## Web, Jellyfin Web et Fire TV

Les trois clients suivent latest.html. Une semaine purement éditoriale ne nécessite donc aucune nouvelle APK.

Une APK est reconstruite seulement lorsqu'une modification native sous integrations/androidtv est nécessaire. Le pont Android TV possède un protocole versionné ; la page TV signale explicitement une APK devenue trop ancienne.

Les remplacements Fire TV utilisent l'état Jellyfin played, pas le localStorage d'un autre appareil.

## Données privées

Le registre Vu du navigateur classique reste local au navigateur. Vos Uploads est exclusivement disponible dans Jellyfin Web, pas sur Fire TV. Les identifiants Forumactif de Vos Uploads restent exclusivement sur le serveur Jellyfin et ne doivent jamais être commités ni embarqués dans l'APK.

## Surveillance et échec

Le watchdog GitHub s'exécute le samedi à 10:00 UTC, après l'échéance de retry. Il vérifie le déploiement public du numéro attendu. Toute PR candidate ou de promotion encore ouverte est un état en attente, signalé par une issue et un job rouge avec les checks dans le résumé. Un numéro manquant ou un brouillon bloqué provoque également une alerte.

Si une source devient inaccessible, incomplète ou ambiguë : essayer une source distincte pertinente selon la règle Web, consigner la dégradation et conserver le numéro en draft si les seuils minimaux ne sont plus démontrables. Ne jamais inventer pour faire passer le CI.

## Reprise automatique et preuve de fusion

La revalidation du brouillon courant est aussi déclenchée après chaque modification de main et toutes les heures, chaque jour. Elle fige le SHA de main au début du run et ne travaille que sur la cible calendaire encore draft. Une panne transitoire ou une attestation devenue ancienne peut ainsi être reprise sans intervention ; une erreur éditoriale continue de bloquer.

Avant chaque fusion, le producteur relit main et le SHA de tête de la PR, exige que main soit ancêtre de cette tête (sinon synchroniser la branche et attendre les nouveaux checks), puis utilise la fusion avec SHA de tête attendu. Pour une promotion, l’attestation doit correspondre au main ainsi relu. Ne jamais fusionner sur la seule base d’un ancien résultat vert. La ruleset reste inchangée ; la fenêtre de concurrence entre cette dernière lecture et la fusion n’est pas atomiquement supprimée sans règle GitHub de branche à jour.

Le watchdog maintient une alerte unique par semaine, avec checks en attente ou échoués, et signale aussi un échec Pages après promotion. Une nouvelle vérification réussie clôt l’alerte correspondante.

Le protocole Android minimal requis est défini par la configuration et le contrôle du pont, actuellement version 4. Le pont distingue l’état played inconnu de false. Installer une APK compatible est nécessaire. Les essais du modèle dans Chromium ne certifient pas le fonctionnement sur un appareil Fire TV physique.

## Production hybride et reprise dans Chat

La production normale est une session continue (« Deux modes de conduite » ci-dessus) ; le protocole opérationnel des reprises est `docs/HYBRID-WORKFLOW.md`. Les tâches inventaire et enrichissement privilégient les résultats éditoriaux et les checkpoints ; les contrôles répétitifs et la publication mécanique sont confiés à GitHub. Les cinq anciennes tâches sont conservées en pause, remplacées par une tâche unique de reprise horaire ; son moteur et son quota ne sont pas migrés automatiquement vers Chat.

`prepare-editorial-handoff.yml` exporte le contexte, `import-editorial-handoff.yml` importe les lots communs depuis une branche handoff, et `weekly-publisher.yml` peut effectuer les fusions protégées et créer la PR de promotion. Il exige une revue éditoriale explicite liée aux empreintes des livrables, en plus de tous les contrôles existants. Il ne remplace aucune validation de qualité par un simple marqueur. Toute modification invalide la revue des fichiers concernés.

En préflight, après la revue des sources et la résolution de tous les travaux restants, enregistrer la revue avec `scripts/seal-editorial-review.mjs WEEK --review-completed`, puis commiter ce checkpoint. En publication/retry, inspecter d'abord le publicateur GitHub et ne pas dupliquer sa PR. Reprendre seulement l'étape bloquée ; ne jamais contourner une approbation GitHub. Le jeton intégré peut exiger une approbation des workflows de PR ; un secret dédié autorisé peut être nécessaire pour un cycle entièrement autonome. Les dates, seuils, garde-fous et l'exclusion de Vos Uploads de Fire TV restent applicables.

Les détails de reprise et les tests du bail sont décrits dans `docs/HYBRID-WORKFLOW.md`. Les PR GitHub doivent être normales (`draft: false`) pour la fusion, même si les données de la candidate restent draft. Une promotion orpheline ne se reprend que si sa transaction et sa base exactes sont encore valides. Le watchdog revient après midi et après les passages du publicateur pour fermer les alertes dont le déploiement est vérifié.

La préparation mécanique des sources, du rapprochement au catalogue et des seuls écarts à traiter est décrite dans [EDITORIAL-DATAFLOW.md](docs/EDITORIAL-DATAFLOW.md). Elle réutilise l'inventaire et les preuves au SHA exact, collecte les formats officiels supportés seulement si nécessaire et prépare des ajouts contrôlés ; elle ne choisit ni ne certifie le numéro.

Un magazine Télérama fourni reste facultatif selon [EDITORIAL-TELERAMA.md](docs/EDITORIAL-TELERAMA.md). Sa grille devient la référence des faits imprimés et relus pour la cible ; l’import seul ne certifie ni une transcription ni la couverture. Il complète la présélection et le rappel des omissions, conserve pages et empreintes et laisse les contrôles hors grille et de publication applicables. Le parcours sans PDF reste disponible.
