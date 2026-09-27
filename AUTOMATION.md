# Sélection TV — automatisation hebdomadaire

## But

Le système doit produire chaque numéro du samedi au vendredi avec une qualité au moins équivalente aux numéros S40/S41, tout en appliquant les garde-fous plus stricts introduits à partir de S42.

L'automatisation est volontairement séparée en deux fonctions : le producteur éditorial est un agent de recherche disposant du Web et de GitHub ; le contrôleur/publicateur est GitHub Actions. GitHub Actions ne doit jamais inventer une sélection éditoriale à partir de données insuffisantes.

## Calendrier et cible

La cible est le prochain numéro commençant samedi et se terminant vendredi, calculé dans le fuseau Europe/Paris. La commande canonique est node scripts/next-target.mjs.

Le cycle officiel comporte cinq étapes dans le fuseau Europe/Paris : inventaire jeudi 08:00, enrichissement vendredi 08:00, préflight vendredi 17:00, publication vendredi 20:00, puis retry samedi 08:00 si nécessaire. Chaque étape vérifie d'abord si la cible est déjà publiée et évite tout travail ou doublon inutile. La configuration machine-readable est data/automation-config.json.

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

Chaque ligne d'inventaire conserve title, start, channel, source et source_url. Chaque journée conserve source_pages, channels_scanned et channel_counts. Une simple liste de chaînes déclarées comme scannées ne remplace jamais les lignes de programmes.

Une seconde source indépendante et une passe de rappel éditoriale sont obligatoires. Télérama peut servir à détecter des omissions mais son jugement ne doit pas être copié.

## Enrichissement

Tout programme retenu, y compris une réserve ou une ligne de grille commentée, doit être prêt pour le Web et Fire TV.

Il faut vérifier : work_id, titre, aliases utiles, réalisateur ou créateur, année, pays, durée, genre, synopsis informatif, justification éditoriale propre, chaîne, horaire, affiche réelle, image_source_url, image_checked, fallbacks utiles, notes vérifiables et au moins une identité forte directe IMDb/TMDb/SensCritique/AlloCiné ou page officielle propre à l'œuvre.

Aucune URL de résultats de recherche n'est admise et aucune donnée manquante ne doit être remplacée par une information seulement plausible.

## Hiérarchie et réserves

Chaque jour comporte normalement trois choix développés, au moins dix candidats complets au total et un objectif de quinze. Les rangs 4+ sont des recommandations complètes capables de remplacer immédiatement un programme déjà vu.

Une pénurie n'est admise qu'avec un shortage_reason structuré et sourcé. La fraîcheur inter-numéros est contrôlée par validate-freshness.mjs.

Les autres rubriques respectent data/editorial-config.json et data/personalization-config.json : rendez-vous, replay, plateformes, sorties, expirations, radar de popularité et radar 1080p. Aucun quota ne justifie une recommandation faible.

## Validation de la candidate

La PR auto/YYYY-Sxx est testée explicitement via SELECTION_TV_VALIDATE_WEEK et SELECTION_TV_CANDIDATE. Le brouillon est rendu par Chromium via preview=1, mais issue-loader.js n'autorise ce preview que sur localhost/127.0.0.1.

Les contrôles couvrent : architecture, contrat d'automatisation, contrat de candidate, éditorial, liens exacts, fraîcheur, réserves, santé distante des images, rendu desktop/responsive/print et modèle tv=1 de Fire TV.

## Fusion et promotion

La PR auto/YYYY-Sxx ne doit être fusionnée que lorsque les contrôles obligatoires sont verts.

Après fusion de la PR auto/YYYY-Sxx, la semaine est encore un brouillon sur main. Le workflow promote-validated-week.yml reprend alors la semaine depuis le nom de branche, rejoue les validations, reteste les images distantes, Chromium, Jellyfin Web et le modèle Fire TV, puis simule localement scripts/promote-week.mjs. Ce workflow ne pousse plus rien sur main.

Si cette revalidation post-fusion est verte, le producteur crée une seconde branche promote/YYYY-Sxx depuis le main courant. Cette branche ne modifie que data/manifest.json et data/weeks/YYYY-Sxx.json selon la transition atomique produite par promote-week.mjs : manifest.latest devient YYYY-Sxx, le statut de l'entrée passe à published et publication_status passe à published. Une seconde PR vers main est alors ouverte. Elle doit elle aussi passer les contrôles obligatoires avant fusion.

Ainsi, même la promotion finale respecte la protection native de main : aucun bypass n'est nécessaire. Si un contrôle échoue à l'une des deux étapes, l'ancien numéro reste public.

guard-direct-publication.yml constitue une défense supplémentaire : il accepte seulement une transition exacte de deux fichiers, draft vers published, et traite toute autre modification de manifest.latest comme non conforme.

## Web, Jellyfin Web et Fire TV

Les trois clients suivent latest.html. Une semaine purement éditoriale ne nécessite donc aucune nouvelle APK.

Une APK est reconstruite seulement lorsqu'une modification native sous integrations/androidtv est nécessaire. Le pont Android TV possède un protocole versionné ; la page TV signale explicitement une APK devenue trop ancienne.

Les remplacements Fire TV utilisent l'état Jellyfin played, pas le localStorage d'un autre appareil.

## Données privées

Le registre Vu du navigateur classique reste local au navigateur. Les identifiants Forumactif de Vos Uploads restent exclusivement sur le serveur Jellyfin et ne doivent jamais être commités ni embarqués dans l'APK.

## Surveillance et échec

Le watchdog GitHub s'exécute le samedi à 10:00 UTC, après la fenêtre de retry. Il vérifie que le numéro samedi-vendredi attendu est publié ou qu'une PR auto/YYYY-Sxx / promote/YYYY-Sxx existe encore comme état récupérable. Un numéro manquant ou un brouillon bloqué provoque une issue d'alerte.

Si une source devient inaccessible, incomplète ou ambiguë : essayer une source indépendante, consigner la dégradation et conserver le numéro en draft si les seuils minimaux ne sont plus démontrables. Ne jamais inventer pour faire passer le CI.
