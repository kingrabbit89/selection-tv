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

`--collect-official` remplace le plan par huit guides ARTE (veille incluse) et
huit XML France 2/3/4/5 (semaine actuelle et précédente pour la première nuit).
Cette amorce couvre **cinq chaînes
seulement** : couverture large et rappel indépendant restent à faire. Les
fournisseurs non supportés et pages bloquées restent des lacunes, jamais des
guides vides certifiés. Aucun contournement de challenge n'est prévu.

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
cartes héritées. Choix, textes, indépendance des sources, fraîcheur, preuves,
contrôles navigateur et revue finale restent du travail éditorial obligatoire.

## Source papier facultative

À partir de S43, les appréciations positives d’un Télérama importé constituent les premières pistes de la présélection, avec leurs critiques attribuées, avant de compléter et équilibrer depuis les autres sources. `initial_editorial_suggestions` reste disponible en entier ; la priorité de file ne s’applique qu’avant la première shortlist, sans réécrire les décisions sauvegardées. Un PDF Télérama peut compléter les lots selon [EDITORIAL-TELERAMA.md](EDITORIAL-TELERAMA.md), avec page et empreinte d’origine. Sans PDF ni supplément sauvegardé, le parcours actuel est inchangé. `--without-telerama` permet de préparer un lot depuis les seules sources courantes.

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
