# Sélection TV — automatisation hebdomadaire

## But

Le système doit produire chaque numéro du samedi au vendredi avec une qualité au moins équivalente aux numéros S40/S41, tout en appliquant les garde-fous plus stricts introduits à partir de S42.

L'automatisation est volontairement séparée en deux fonctions : le producteur éditorial est un agent de recherche disposant du Web et de GitHub ; le contrôleur/publicateur est GitHub Actions. GitHub Actions ne doit jamais inventer une sélection éditoriale à partir de données insuffisantes.

## Calendrier et cible

La cible est le prochain numéro commençant samedi et se terminant vendredi, calculé dans le fuseau Europe/Paris. La commande canonique est `node scripts/next-target.mjs`. Le samedi, la cible reste le samedi courant. Si un cycle a échoué, le cycle suivant saute les éditions non publiées devenues obsolètes : il produit la cible calendaire actuelle, sans rattrapage de programmes périmés. Les validateurs et la promotion appliquent cette même règle ; leurs logs nomment les cycles sautés. Les anciens brouillons restent non publics. Aucun seuil éditorial ne change.

Le cycle officiel conserve cinq jalons dans le fuseau Europe/Paris : inventaire jeudi 08:00, enrichissement vendredi 08:00, préflight vendredi 17:00, publication vendredi 20:00, puis retry samedi 08:00 si nécessaire. Ces jalons sont désormais exécutés par une seule tâche de reprise horaire (jeudi–samedi, 8 h–23 h Europe/Paris) ; les cinq anciennes tâches sont en pause. Chaque étape vérifie d'abord si la cible est déjà publiée et évite tout travail ou doublon inutile. La configuration machine-readable est data/automation-config.json.

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

Une seconde source indépendante et une passe de rappel éditoriale sont obligatoires. Télérama peut servir à détecter des omissions mais son jugement ne doit pas être copié.

## Progression de la recherche et impasses

« Inventaire avant sélection » impose la prospection large des sept jours avant le choix final ; cela n'impose pas d'achever une fiche complète pour chaque entrée brute ni de résoudre chaque conflit avant de commencer l'enrichissement. Une fois le relevé primaire des sept jours et des chaînes actives effectué, approfondir les candidats prometteurs et leurs alternatives pendant que les recoupements de couverture encore nécessaires se poursuivent. Le stade `enrichment` peut donc conserver des tâches d'inventaire dans `remaining`. La certification finale des sept jours, la seconde source indépendante, le rappel éditorial, la passe documentaire et tous les seuils restent obligatoires avant `ready`.

À chaque reprise, distinguer : exigences de couverture/publication encore manquantes ; champs à terminer pour les candidats prometteurs et leurs alternatives ; pistes non retenues ou impasses. Choisir une tâche utile qui peut progresser, plutôt que la première ligne `remaining` si elle attend une source absente. Après le relevé primaire, donner priorité à l'achèvement de dossiers déjà étayés et à leur sauvegarde dans les livrables autorisés, avant d'ajouter de nouvelles pistes. Le catalogue canonique n'accueille que les champs effectivement vérifiés ; les données hebdomadaires restent draft.

Après une tentative ciblée et une voie alternative distincte sans résultat exploitable, consigner dans un champ additionnel `research_attempts` de `data/research/YYYY-Sxx.json` : identifiant de tâche, objet/version/diffusion, question non résolue, sources exactes, dates réelles, résultat, caractère bloquant, statut, et condition concrète de reprise. Ne pas répéter les mêmes pages ou requêtes au passage suivant sans nouvelle source, modification observée ou contrôle de fraîcheur nécessaire. Ce mécanisme évite les répétitions ; il n'autorise ni à déduire la réponse ni à écourter les recherches critiques requises. Des observations déjà sauvegardées peuvent alimenter ce registre sans inventer une nouvelle consultation.

Une piste dont l'identité, la disponibilité ou l'intérêt restent insuffisamment étayés reste hors recommandations et réserves. Conserver sa preuve et sa limite dans coverage/research, avec une décision motivée. Une exclusion réellement examinée peut clore le travail sur cette piste ; une recherche simplement différée ne vaut pas exclusion ni vérification terminée. Toute impasse affectant une exigence de couverture, un seuil, un programme retenu ou une réserve reste dans `remaining` et bloque la publication jusqu'à résolution ou remplacement par une alternative entièrement vérifiée. Ne jamais retirer une chaîne active, déclarer `full_week_reaudit_completed` ou vider `remaining` pour contourner une source indisponible.

Dans `run_metrics`, distinguer nouvelles pistes, dossiers incomplets suivis, fiches complètes et exigences de couverture résolues. Deux passages successifs après le relevé primaire sans fiche complète déclenchent une revue de priorité au passage suivant : expliquer la cause, choisir des dossiers proches de l'achèvement ou traiter leur blocage précis, sans recommencer la collecte générale. Aucun chiffre ne constitue une certification éditoriale ni une obligation de remplir avec un titre faible.

### Enchaîner les lots pendant un passage

La cadence horaire est un filet de reprise, pas un quota d'un lot par exécution. Viser moins de 35 minutes de travail actif par passage ; sauvegarder régulièrement, puis continuer immédiatement sur le prochain lot utile tant que le temps restant, les outils et le bail permettent le travail et une sauvegarde finale sûre. Une sauvegarde, un dossier achevé, un changement de phase ou un contrôle CI en cours ne sont pas, à eux seuls, des motifs d'arrêt. Éviter les attentes répétées : pendant un contrôle, poursuivre les recherches indépendantes qui peuvent progresser, en gardant la validation finale liée au SHA exact.

Pour un candidat déjà documenté, enchaîner la création de sa fiche draft (identité canonique, champs sourcés, textes, liens et visuel), sa revue et sa sauvegarde dès que les preuves le permettent ; ne pas repousser mécaniquement cette intégration au passage suivant. Un dossier de recherche complet n'est pas compté comme une carte complète. Continuer ensuite avec un autre candidat ou une rubrique ; les étapes déjà achevées restent réutilisées.

Terminer quand le budget utile touche à sa fin, que les outils ou l'exécution sont interrompus, que le bail est perdu/expiré, que toutes les tâches accessibles attendent une dépendance réelle, ou que le numéro est prêt et remis au publicateur. Ne jamais poursuivre sans bail ni contourner une permission. Si possible avant l'arrêt, sauvegarder le travail et enregistrer dans le dernier `run_metrics` un `stop_reason` précis ainsi que le prochain lot utile ; si une interruption empêche cette écriture, la reprise doit l'indiquer comme inconnue, sans inventer sa cause ou sa durée. Ne pas attendre pour atteindre artificiellement 35 minutes. La durée visée ne garantit ni durée réelle d'exécution ni quota disponible.

### Paquet de travail ciblé

Avant de relire les checkpoints complets, utiliser `node scripts/editorial-work-packet.mjs YYYY-Sxx --ref SHA_CANDIDATE` depuis un clone disposant du commit courant. L'outil lit une seule révision Git immuable, ne modifie aucun fichier et affiche l'état des livrables, les exigences ouvertes, les dossiers signalés comme complets pour comparaison, les impasses et des correspondances de titre avec le catalogue. La liste des correspondances est alphabétique et bornée (`--limit 1..40`) ; elle ne constitue ni classement artistique ni sélection. Des données présentes dans le catalogue ne deviennent pas vérifiées par cette extraction.

Pour un dossier choisi, utiliser `--title "Titre exact"` : le paquet rassemble les entrées canoniques possibles, liens centraux, diffusions brutes, dossier critique, tentatives et vérifications enregistrées. Les dates de consultation, statuts de conflit/indisponibilité, versions et limites sont conservés. Les homonymes/remakes restent séparés et les absences restent visibles. Examiner les preuves ainsi regroupées, rechercher seulement les informations manquantes ou périssables, puis intégrer les champs réellement vérifiés et rédiger la fiche draft. Ne jamais utiliser une correspondance de titre seule pour réutiliser l'identité, une note ancienne ou une disponibilité.

Le paquet n'atteste jamais `ready`, ne choisit pas les programmes, ne remplit pas de textes et ne scelle pas la revue. Si le shell/Git n'est pas disponible, effectuer la même extraction ciblée avec les outils connectés en conservant le SHA et toutes les limites ; ne pas prétendre avoir exécuté le helper. La petite vue de travail réduit les lectures répétées, pas les critères. Refaire l'extraction après un changement du checkpoint pertinent.

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

Le watchdog GitHub s'exécute le samedi à 10:00 UTC, après la fenêtre de retry. Il vérifie le déploiement public du numéro attendu. Toute PR candidate ou de promotion encore ouverte est un état en attente, signalé par une issue et un job rouge avec les checks dans le résumé. Un numéro manquant ou un brouillon bloqué provoque également une alerte.

Si une source devient inaccessible, incomplète ou ambiguë : essayer une source indépendante, consigner la dégradation et conserver le numéro en draft si les seuils minimaux ne sont plus démontrables. Ne jamais inventer pour faire passer le CI.

## Reprise automatique et preuve de fusion

La revalidation du brouillon courant est aussi déclenchée après chaque modification de main et toutes les heures les vendredis et samedis. Elle fige le SHA de main au début du run et ne travaille que sur la cible calendaire encore draft. Une panne transitoire ou une attestation devenue ancienne peut ainsi être reprise sans intervention ; une erreur éditoriale continue de bloquer.

Avant chaque fusion, le producteur relit main et le SHA de tête de la PR, exige que main soit ancêtre de cette tête (sinon synchroniser la branche et attendre les nouveaux checks), puis utilise la fusion avec SHA de tête attendu. Pour une promotion, l’attestation doit correspondre au main ainsi relu. Ne jamais fusionner sur la seule base d’un ancien résultat vert. La ruleset reste inchangée ; la fenêtre de concurrence entre cette dernière lecture et la fusion n’est pas atomiquement supprimée sans règle GitHub de branche à jour.

Le watchdog maintient une alerte unique par semaine, avec checks en attente ou échoués, et signale aussi un échec Pages après promotion. Une nouvelle vérification réussie clôt l’alerte correspondante.

Le protocole Android 3 est requis pour distinguer l’état played inconnu de false. Installer l’APK compilée après cette mise à jour est nécessaire. Les essais du modèle dans Chromium ne certifient pas le fonctionnement sur un appareil Fire TV physique.

## Production hybride et reprise dans Chat

Le protocole opérationnel est `docs/HYBRID-WORKFLOW.md`. Les tâches inventaire et enrichissement privilégient les résultats éditoriaux et les checkpoints ; les contrôles répétitifs et la publication mécanique sont confiés à GitHub. Les cinq anciennes tâches sont conservées en pause, remplacées par une tâche unique de reprise horaire ; son moteur et son quota ne sont pas migrés automatiquement vers Chat.

`prepare-editorial-handoff.yml` exporte le contexte, `import-editorial-handoff.yml` importe les lots communs depuis une branche handoff, et `weekly-publisher.yml` peut effectuer les fusions protégées et créer la PR de promotion. Il exige une revue éditoriale explicite liée aux empreintes des livrables, en plus de tous les contrôles existants. Il ne remplace aucune validation de qualité par un simple marqueur. Toute modification invalide la revue des fichiers concernés.

En préflight, après la revue des sources et la résolution de tous les travaux restants, enregistrer la revue avec `scripts/seal-editorial-review.mjs WEEK --review-completed`, puis commiter ce checkpoint. En publication/retry, inspecter d'abord le publicateur GitHub et ne pas dupliquer sa PR. Reprendre seulement l'étape bloquée ; ne jamais contourner une approbation GitHub. Le jeton intégré peut exiger une approbation des workflows de PR ; un secret dédié autorisé peut être nécessaire pour un cycle entièrement autonome. Les dates, seuils, garde-fous et l'exclusion de Vos Uploads de Fire TV restent applicables.

Les détails de reprise et les tests du bail sont décrits dans `docs/HYBRID-WORKFLOW.md`. Les PR GitHub doivent être normales (`draft: false`) pour la fusion, même si les données de la candidate restent draft. Une promotion orpheline ne se reprend que si sa transaction et sa base exactes sont encore valides. Le watchdog revient après midi et après les passages du publicateur pour fermer les alertes dont le déploiement est vérifié.
