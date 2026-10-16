# Préparer les seuls écarts de production

La préparation hebdomadaire réutilise les identités, preuves et textes fiables,
actualise les créneaux et offres, puis complète les seuls champs manquants des
propositions choisies. Les helpers préparent ce travail sans écrire la candidate.

## Reprise d'un inventaire sauvegardé

```sh
node scripts/editorial-production-flow.mjs YYYY-Sxx \
  --ref SHA_CANDIDATE --out-dir /tmp/lot-nouveau --limit 6
```

Le dossier doit être nouveau. `summary.json` indique les manques de positions et
la pagination ; `work-batch.json` joint l'inventaire au catalogue canonique,
liens, dossiers, preuves, cartes existantes et historique au même SHA immuable.
Aucun accès réseau n'a lieu dans ce mode. Après une sauvegarde, recalculer au
nouveau SHA ; `--offset N` parcourt la file si nécessaire.

Chaque ligne distingue acquis (`cached_facts`, `saved_texts`, liens et pointeurs),
champs manquants, faits périssables, conflits et pauses de portée précise. Les
dates et scopes originaux sont conservés. Une preuve stable de réalisateur peut
être reprise sans sa durée propre à une autre version. Un titre exact ne résout
jamais à lui seul un remake, une version ou une disponibilité.

Les acquis exploitables et la présélection passent avant les nouveaux intitulés
bruts. Ceux-ci ont `work_stage: editorial_triage_before_full_enrichment` et
demandent un tri, pas une fiche complète obligatoire pour chaque entrée de grille.
L'ordre est technique et ne calcule aucun mérite artistique. Les données en cache
ne sont ni une nouvelle consultation ni une certification de qualité.

## Collecte nécessaire

```sh
node scripts/editorial-production-flow.mjs YYYY-Sxx --ref SHA_CANDIDATE \
  --out-dir /tmp/acquisition-nouvelle --source-plan /tmp/sources.json \
  --cache-dir /tmp/selection-source-cache --limit 6
```

Le plan est `{ "schema_version": 1, "sources": [...] }`. Chaque source porte
`id` unique, `adapter`, `url`, `channel` et `date` explicites. Les dates de page
couvrent le samedi jusqu'au vendredi, ou la veille pour la première nuit ; le
XML hebdomadaire accepte aussi le samedi précédent pour cette première nuit.
Les formats supportés ont été vérifiés sur de vraies réponses :

| Adaptateur | URL / portée |
|---|---|
| `arte-guide-html` | `https://www.arte.tv/fr/guide/YYYYMMDD/`, chaîne `Arte` ; jour de grille décalé, passage de minuit conservé |
| `francetvpro-grid-html` | `https://www.francetvpro.fr/grille/france-N/DD-MM-YYYY/DD-MM-YYYY`, France 2/3/4/5 ; heure civile Paris depuis le datetime explicite |
| `francetvpro-grid-xml` | `https://www.francetvpro.fr/grille-xml/france-N/DD-MM-YYYY`, France 2/3/4/5 ; XML officiel response/item hebdomadaire, fin de nuit D+7 avant 06h |
| `tv5monde-psi-json` | `https://www.tv5mondeplus.com/api/psi/programs-grid?language=fr&timezone=Europe%2FParis&channel=6&day=YYYY-MM-DD&page=N&limit=10`, chaîne `TV5MONDE` (flux France Belgique Suisse Monaco) ; guide officiel paginé (10 programmes par page), journée de diffusion 04h–04h, heure civile Paris depuis l'offset explicite ; une page après la dernière est `beyond_last_page`, jamais une grille vide |
| `tele7jours-html` | `https://www.programme-television.org/tv/chaines/<slug>/<jour>[-prochain]`, table explicite de 28 chaînes (`TELE7JOURS_CHANNELS`) ; pages relatives (« jour » = 1 à 7 jours, « jour-prochain » = 8 à 13 jours), **date prouvée par le titre de la page**, page sans date refusée, bascule après minuit ; guide tiers à provenance amont inconnue |

`--collect-official` remplace le plan par huit guides ARTE (veille incluse) et
huit XML France 2/3/4/5 (semaine actuelle et précédente pour la première nuit).
Cette amorce couvre **cinq chaînes
seulement** : couverture large et rappel indépendant restent à faire. Les
fournisseurs non supportés et pages bloquées restent des lacunes, jamais des
guides vides certifiés. Aucun contournement de challenge n'est prévu.

`--collect-wide` ajoute à cette amorce la grille officielle TV5MONDE (veille
incluse, pages 1 à 6) et Télé 7 Jours **pour les seules chaînes sans grille
officielle** (23 chaînes) : une même émission n'est donc jamais importée deux fois
avec des minutes différentes. Les requêtes vers un même hôte sont espacées de
1,5 s et une réponse 429 attend `Retry-After` ; Télé 7 Jours refuse les rafales.
Le résumé expose `pagination_gaps` (pages TV5MONDE manquantes ou incomplètes) et
`unreachable_guide_dates` (dates hors de la fenêtre de 1 à 13 jours de Télé 7
Jours), à collecter un autre jour. Comme pour l'amorce officielle, ces
observations restent brutes : la seconde lecture des omissions, la comparaison
avec un autre guide et le contrôle tardif des créneaux retenus restent à faire.
Sous Windows, l'extraction du PDF Télérama utilise `python` (ou
`SELECTION_TV_PYTHON`), `python3` y étant un raccourci du Microsoft Store.

La collecte borne concurrence, délais, octets et reprises transitoires. Le cache
est vérifié par empreinte et garde sa date originale. Un cache expiré provoque
une acquisition ; après un échec observé seulement, son ancienne capture reste
visible avec statut `stale` et erreur explicite. `--refresh` force une acquisition
justifiée et exige un mode de collecte. `--source-report /tmp/rapport-sauve.json`
réutilise un rapport existant sans réseau. Une capture `input_file` reste
`provided_file`, avec `captured_at` explicite ou nul ; elle ne simule jamais une
requête HTTP courante.

`source-report.json` garde observations brutes, captures locales, hashes, dates,
statuts, erreurs et avertissements. Le lot rapproche ces observations sans les
attribuer au Git d'origine. « Cinéma de minuit » reste un conflit de créneau avec
un film identifié, jamais un alias global. Les dates nocturnes sont celles des
diffusions, pas la date de la page.

## Ajouts d'inventaire contrôlés

La collecte exige un checkpoint avec `remaining` non vide. Pour une semaine
vide, initialiser ce checkpoint sous bail avec les exigences des contrats avant
la collecte. L'outil n'invente et ne ferme aucune exigence éditoriale.

Le flow écrit `inventory-normalization.json` et un `inventory-handoff.json`
s'il y a des observations nouvelles. L'import déduplique, conserve les lignes
et champs sauvegardés, écarte les dates hors semaine et captures `stale`, signale
les titres divergents au même créneau et ajoute seulement les observations
validées par leur réponse source. Les compteurs reflètent les lignes, sans
certifier la couverture. Les flags de coverage et `full_week_reaudit_completed`
restent inchangés ; catalogue, manifeste, cartes et notes ne sont pas écrits.

```sh
node scripts/editorial-handoff.mjs check /tmp/acquisition-nouvelle/inventory-handoff.json
# Après revue des ajouts, sous bail valide et base exacte :
node scripts/editorial-handoff.mjs apply /tmp/acquisition-nouvelle/inventory-handoff.json
```

L'empreinte de base vient des octets Git exacts, jamais d'un JSON resérialisé.
Une base modifiée exige réconciliation. Sauvegarder la provenance utile avec le
checkpoint dans les chemins autorisés, ou conserver la capture pour la revue.
Si elle est perdue, ne pas prétendre l'avoir relue ; reprendre une preuve
sauvegardée ou acquérir à nouveau avec une date réelle.

Pour produire les cartes revues, utiliser [EDITORIAL-DRAFTS.md](EDITORIAL-DRAFTS.md).
Son mode `append_days` ajoute les seules réserves nouvelles sans réécrire les
cartes héritées. Choix, textes, portée et limites des sources, fraîcheur, preuves,
contrôles navigateur et revue finale restent du travail éditorial obligatoire.

## Source papier facultative

À partir de S43, les appréciations positives d’un Télérama importé constituent les premières pistes de la présélection, avec leurs critiques attribuées, avant de compléter et équilibrer depuis les autres sources. `initial_editorial_suggestions` reste disponible en entier ; la priorité de file ne s’applique qu’avant la première shortlist, sans réécrire les décisions sauvegardées. Un PDF Télérama peut compléter les lots selon [EDITORIAL-TELERAMA.md](EDITORIAL-TELERAMA.md), avec page et empreinte d’origine. Sans PDF ni supplément sauvegardé, le lot expose `web_schedule_evidence` : preuve officielle ou recoupement concordant de guides actuels, revue réelle des omissions et provenance technique consignée séparément. `--without-telerama` permet de préparer un lot depuis les seules sources courantes.

## Affiches à la sélection

Les affiches se résolvent quand l'œuvre est choisie, pas au scellement. Le
résolveur part des seuls liens d'identité exacts déjà vérifiés (`data/links.json`
et `links` de l'œuvre) et suit une échelle fixe :

| Rang | Source | Visuel |
|---|---|---|
| 1 | fiche SensCritique exacte (`/film/…/ID` ou `/serie/…/ID`) | affiche du JSON-LD (`/600/`), sinon `og:image` (photo paysage) |
| 2 | fiche IMDb exacte `/title/tt…` | `og:image` m.media-amazon.com |
| 3 | API TMDb (si `TMDB_API_KEY`) | affiche w500, française d'abord ; `/find/tt…` sans identifiant TMDb |
| 4 | page officielle du programme | ARTE api-cdn, FranceTVPro `contenu-de-presse/ID`, page de grille TV5MONDE lue par le collecteur suivie de `#program=<provider_id>` |
| 5 | aucune | `image_exception_reason` existante conservée |

Chaque candidate passe le contrôle de `validate-image-sources.mjs` (sans Referer,
signature d'image réelle). Une page redirigée vers un autre identifiant, une
année incohérente ou un challenge anti-robot (IMDb répond souvent par un AWS WAF)
est consignée et jamais contournée. Pas de page de recherche, de Google Images ni
de CAPTCHA. Une clé `links.json` partagée par plusieurs œuvres est ignorée.

```sh
# Visuels de la semaine (même ensemble que validate-image-sources) :
# image manquante, ou image sans secours.
node scripts/poster-resolver.mjs --week YYYY-Sxx --dry-run
# Remplacer seulement les images principales qui échouent aujourd'hui.
node scripts/poster-resolver.mjs --week YYYY-Sxx --repair
node scripts/poster-resolver.mjs --repair --work ID --work ID2 --report /tmp/affiches.json
```

L'écriture renseigne `image`, `image_type`, `image_source_url`, `image_checked`,
`image_strategy` (`resolver:senscritique`, `resolver:arte`…) et une à deux
`image_fallbacks` d'un autre hôte de l'échelle. Une image principale qui répond
n'est jamais remplacée. En réparation, les secours qui répondent encore sont
gardés et les morts retirés. Les requêtes vers un même hôte sont espacées
(`--pace-ms`, 1200 par défaut). Une œuvre sans lien exact, ou dont toutes les
sources échouent, reste `unresolved` (code de sortie 1) : ajouter d'abord son
identité exacte.

Dans le flow, `--resolve-posters` traite les lignes du lot qui ont un seul
candidat canonique. Il écrit `poster-resolution.json` et, s'il y a des
changements, `poster-handoff.json` (`data/works.json` à la base exacte), à
vérifier puis appliquer avec `editorial-handoff.mjs` sous bail. Ce mode utilise
le réseau ; il est refusé pour un checkpoint `ready` ou scellé.

### Copies WebP dans le site

Une fois l'image distante choisie (à la main ou par le résolveur), une copie légère
est servie par le site lui-même : `assets/posters/<id>.webp`, 360 × 540 au plus,
qualité 76, sans métadonnées (environ 30 Ko). `image` pointe vers ce fichier ;
l'URL distante d'origine reste dans `image_remote` et en tête d'`image_fallbacks`.
`image_source_url`, `image_strategy` et les autres champs éditoriaux ne changent pas.

```sh
node scripts/poster-copy.mjs --week YYYY-Sxx    # ou --work ID..., --all
node scripts/poster-copy.mjs --all --refresh    # retélécharge depuis image_remote
node scripts/poster-copy.mjs --check            # contrôle CI, sans réseau
```

L'encodage (Pillow, `scripts/poster-webp.py`, lancé avec `python` sous Windows ou
`SELECTION_TV_PYTHON`) ne tourne qu'en local ; la CI vérifie seulement les fichiers.
Le téléchargement utilise le même client sans Referer que `validate-image-sources`,
s'arrête à la première source saine et écarte HTML et SVG. Une copie existante
n'est pas refaite : relancer la commande ne crée aucune différence. `--check`
exige un vrai WebP nommé d'après l'œuvre, dans la limite de taille, l'original
distant conservé et aucun fichier orphelin.

Les chemins `assets/posters/…` sont relatifs à la racine du site : `image-resolver.js`,
`android-tv-mode.js` et `jellyfin-bridge.js` les résolvent depuis l'URL de
`data/works.json`. Sur une page hebdomadaire qui affiche encore l'original distant,
la copie le remplace tant que l'image distante n'est pas déjà visible.

Ces fichiers binaires ne font pas partie des chemins d'une candidate
(`allowedPaths`) ni d'un handoff : ils passent par une PR ordinaire vers `main`.

## Clôture depuis les défauts actuels

```sh
node scripts/preparation-gaps.mjs YYYY-Sxx --json preparation-gaps.json
```

Le tableau `task_board.calculated` regroupe les messages connus qui demandent
la même action (audit de couverture, profondeur des réserves d'un jour,
chevauchements du radar). Tous les diagnostics d'origine restent présents.
Les défauts inconnus restent séparés, les avertissements distincts des blocages
et un contrôle interrompu laisse une observation partielle. Le rapport de
génération n'utilise ce tableau que si semaine, empreintes de ses entrées et
exécution CI correspondent encore. Les paragraphes `remaining` sont un suivi
éditorial déclaré à réconcilier sur preuves, jamais un compte de tâches actives.

## Réconcilier les réserves du radar

```sh
# Remplacer ID_PASSAGE et ID_PREVIEW ; choisir un fichier qui n'existe pas.
node scripts/editorial-radar-reconcile.mjs YYYY-Sxx --json /tmp/radar-plan-ID_PASSAGE-ID_PREVIEW.json
# Après lecture du plan, sur la même base et sous bail valide :
node scripts/editorial-radar-reconcile.mjs YYYY-Sxx --apply-plan /tmp/radar-plan-ID_PASSAGE-ID_PREVIEW.json
```

Le premier appel prépare un plan local. Le second retire uniquement les
doublons d'identités canoniques certaines, après vérification du HEAD et des
empreintes des entrées. Les cartes principales, rangs et preuves hérités sont
conservés ; chaque carte retirée et son motif restent dans le plan. Une identité
ou une version ambiguë demande une décision explicite. Les déficits qui restent
sont calculés avec les minima existants : il faut produire des alternatives
distinctes revues, sans inventer un candidat ou une pénurie. L'application refuse
main/master, un numéro publié ou une revue déjà scellée. La sauvegarde distante
reste soumise au bail et aux contrôles normaux de la candidate.

## Reprendre les recherches sur fait nouveau

La politique `docs/EDITORIAL-CLOSURE-POLICY.md` distingue preuves de source,
impact sur cartes/couverture et notes brutes. `editorial-research-triage.mjs` lit
un checkpoint immuable et affiche les actions accessibles et les attentes
explicitement reliées aux actions exactes, sans modifier la candidate. Le
contrôleur de la nouvelle révision consomme ce même plan ; les exigences
conservées et les gardes de publication restent distinctes des priorités.
