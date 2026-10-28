# Kit de production : dossier de travail et formats d'entrée

`scripts/editorial-kit.mjs` et `scripts/editorial-telerama-kit.py` enchaînent les
étapes d'aide d'une session continue (voir `AUTOMATION.md`, « Kit de
production »). Ils lisent les sources de la semaine sur la branche et un
**dossier de travail** `W` hors du dépôt, par exemple dans le scratchpad de la
session. Tout ce qui est rédigé ou décidé vit dans `W`, en JSON : l'outil ne
fabrique ni texte éditorial, ni rang, ni motif.

```text
W/
  production.json        paramètres de la semaine
  import/                sortie de prepare-telerama-input.py (+ .raw.json)
  review-notes.json      notes de lecture des critiques du jour
  grid-review.json       revue de transcription de la grille
  grid-ratings.json      appréciations de grille (editorial-telerama-kit.py)
  picks.json             choix quotidiens, dans l'ordre du producteur
  printed.json           lignes imprimées des choix (editorial-telerama-kit.py)
  dossiers/*.json        dossiers des sous-agents de recherche
  copy/*.json            textes des cartes (ou copy-*.json à la racine)
  sections/*.json        pages de rubriques, radars, rendez-vous, couverture
  decisions.json         rejets, reports et motifs du bilan de couverture
  out/                   plans, paquets et rapports produits
```

## `production.json`

```json
{"issue_number": "4008", "checked_at": "2026-11-04",
 "channel_aliases": {"LCP-Assemblée nationale": "LCP"},
 "grid_ranks": 8, "radar_card_max_chars": 500}
```

- `issue_number` : numéro imprimé du Télérama, cité dans les notes de diffusion (facultatif).
- `checked_at` : date des revues de cartes ; à défaut, la date du jour à Paris (`--checked-at` l'emporte).
- `channel_aliases` : `{"nom affiché sur la carte": "nom de l'inventaire"}`. Seuls ces alias rapprochent deux chaînes : « Canal+ » ne correspond jamais à « Canal+ Cinéma ».
- `grid_ranks` : seules les cartes de rang inférieur ou égal reçoivent leur ligne de grille commentée (8 par défaut, une page).

## Import Télérama

`review-notes.json` porte une note par critique réellement lue :

```json
{"reviews": [
  {"pdf_page": 117, "title": "Julian", "author": "…", "summary": "Paraphrase brève (≤ 700 caractères)."},
  {"pdf_page": 123, "title": "Trois Pères et un bébé", "raw_title": "Trois Pères et un bébé La Chimè", "author": "…", "summary": "…"}],
 "warnings": ["Critique à avis partagés (Pour/Contre) consignée ici, non importée."]}
```

Une note se rattache à la critique extraite de la même page par son titre ou
par `raw_title` (titre brut de l'extraction) ; un titre différent devient
`reviewed_title`, le titre brut reste. Une note sans critique correspondante
est refusée ; une critique sans note reste non revue et apparaît dans le
rapport. `basis` et `reviewed_at` remplacent au besoin la provenance par défaut.

## Revue de transcription

`grid-review.json` reprend la revue faite en relisant les pages :

```json
{"reviewed_at": "2026-11-04T12:18:38+01:00", "method": "…",
 "pages": [{"pdf_page": 112, "misreads": [{"extracted": "2026-11-09 | 20:00 | France 3 | Stade 2 la",
   "correct": {"title": "Stade 2 la quotidienne"}, "note": "…"}], "omissions": []}],
 "sampled_rows": [{"date": "…", "pdf_page": 112, "title": "…", "start": "20:00", "channel": "France 3", "decision": "corrected", "note": "…"},
   {"date": "…", "pdf_page": 113, "title": "…", "start": "21:00", "channel": "France 5", "decision": "added", "note": "…", "bbox": [20, 60, 90, 68]}],
 "slot_conflicts": [{"date": "…", "channel": "…", "start": "…", "titles": ["…", "…"], "printed": "…", "resolution": "keep both"}],
 "discrepancies": ["…"],
 "replacements": [{"find": "\\bAfaire", "replace": "Affaire"}], "replacements_label": "ligature « ff » perdue",
 "fix_broken_hyphenation": true, "impact_review": "Revue d’impact : …"}
```

Les `misreads` corrigent l'inventaire ; les lignes `added` (et `omissions`)
y sont ajoutées avec leur page et leur position ; `replacements` et
`fix_broken_hyphenation` corrigent les mêmes défauts d'extraction ailleurs
dans la grille. Les seuils de `coverage.grid_inventory.transcription_review`
restent ceux du validateur : la commande refuse d'écrire une revue trop courte.

## Choix quotidiens et catalogue

```json
{"picks": [
  {"date": "2026-11-07", "time": "21:05", "channel": "Gulli", "printed": "Beetlejuice", "primary": true},
  {"day": "dimanche", "time": "22:30", "channel": "Arte", "printed": "Zombies",
   "title": "Zombies : la fascination des morts-vivants"},
  {"date": "2026-11-11", "time": "20:40", "channel": "LCP", "printed": "…", "work_id": "…"}]}
```

`printed` est le titre de la grille, `title` le titre retenu s'il diffère.
Chaque jour, les choix `primary` passent en tête puis les autres dans l'ordre
du fichier (ou selon `rank` explicite). `catalogue` rattache chaque choix à
son dossier (par `query` ou titre) puis au catalogue par lien IMDb ou
SensCritique exact, sinon par titre et année : `existing`, `new` (ID
`titre-année`), `clash` (homonyme à départager), `needs_dossier`,
`needs_year` ou `repeat` (autre diffusion d'une œuvre déjà rattachée, qui garde
sa propre carte ce jour-là). `work_id` explicite tranche une identité.

## Dossiers de recherche

Un fichier par sous-agent, au format de la consigne ci-dessous. Les entrées
peuvent être rangées sous `works`, `additional_proposals`, `popularity`,
`popularity_scan`, `popularity_reserve`, `hd`, `hd_reserve` ou
`sections.<rubrique>` (`replay`, `platform_free`, `platform_subscription`,
`physical_release`, `streaming_release`, `expiring`). Une rubrique lit la clé
qui porte son nom ; deux fichiers qui décrivent la même œuvre pour la même
rubrique sont ambigus et la carte (ou la section) doit nommer `dossier`.
`generated_at` (heure réelle d'écriture) date les preuves d'identité.

Faits lus par rubrique : `offer` (`service`, `url`, `available_until`,
`arrival_date`, `arrival_source`, `last_day`, `label_on_page`), `release`
(`date`, `format`, `editor`, `url`, `restoration`), `signal` et
`signal_source_url`, `added` et `added_source_url`.

### Consigne type des sous-agents (lecture seule)

> Assistant de recherche en lecture seule pour la Sélection TV de la semaine
> YYYY-Sxx (samedi → vendredi). Ne modifie aucun fichier du dépôt ; écris
> seulement ton dossier JSON. Lis réellement chaque page (WebFetch) ; seules
> comptent les pages d'identité exactes (IMDb `title/tt…`, SensCritique
> `film|serie/<slug>/<id>`, AlloCiné `fichefilm_gen_cfilm=…`, Wikipédia,
> page officielle de l'œuvre), jamais une page de résultats ni une URL
> devinée. Vérifie la version (titre, année, réalisateur imprimés) : remakes
> et homonymes sont des pièges. Une valeur non lue vaut `null` ; note l'URL
> de chaque fait. Synopsis de deux ou trois phrases en français, sans
> divulgâcher, avec son URL. Un à trois signaux critiques précis et sourcés.
> Réécris le fichier tous les trois ou quatre titres.

```json
{"agent": "…", "generated_at": "<ISO>", "works": [
 {"query": "<titre listé>", "slots": ["YYYY-MM-DD HH:MM Chaîne"],
  "identity": {"title_fr": "", "original_title": "", "year": 0, "director": "", "country": "", "duration_min": 0, "genre": ""},
  "identity_confidence": "exact|probable|doubtful", "version_note": "",
  "links": {"imdb": null, "sc": null, "allocine": null, "wikipedia": null, "official": null},
  "ratings": {"imdb": null, "senscritique": null, "ratings_read_at": null},
  "synopsis_fr": "", "synopsis_source_url": "", "critical_signals": [{"kind": "", "note": "", "source_url": ""}],
  "poster_url": null, "doubts": []}]}
```

## Textes des cartes

`copy/*.json` associe un `work_id` (ou, à défaut, un titre) à ses textes :

```json
{"the-substance-2024": {"quality": "TRÈS FORT", "summary": "…", "why": "…", "grid_reason": "…"},
 "La Belle et la Bête": {"summary": "…", "why": "…", "added": "Nouveau master 4K…"}}
```

Champs facultatifs : `grid_reason` (ancien nom `grid` accepté), `added`,
`signal`, `signal_source_url`, `offer`, `release`, `links`, `work` (champs
corrigés) et `review` (remplace une note de provenance calculée). Un même
texte écrit deux fois est refusé.

## Rubriques, rendez-vous et couverture

Un fichier de `sections/` donne une ou plusieurs pages, au format des
`sections` de `docs/EDITORIAL-DRAFTS.md`, et peut porter `cover`,
`render_toc`, `methode`, `section_shortages` et `replace_pages` :

```json
{"sections": [
  {"kind": "rendezvous", "page": 1, "target": 5, "header": {"kicker": "…", "h1": "…", "deck": "…"},
   "cards": [{"work_id": "rebecca-1940"}, {"work_id": "…", "date": "2026-11-08"}]},
  {"kind": "radar_hd", "page": 1, "target": 5, "dossier": "RAD.json", "key": "hd,hd_reserve", "header": {"kicker": "…", "h1": "…", "deck": "…"},
   "cards": [{"query": "La Belle et la Bête"}, {"query": "Yojimbo"}]},
  {"kind": "physical_release", "page": 1, "target": 4, "dossier": "RUB.json", "header": {"…": "…"},
   "cards": [{"work_id": "…", "quality": "PATRIMOINE"}]}],
 "cover": {"lead_work_id": "…", "side_work_ids": ["…", "…"], "kicker": "…", "h1": "…", "deck": "…"},
 "render_toc": true}
```

Une carte de rendez-vous reprend la carte du jour déjà décidée (même créneau,
textes et revue, sans ligne de grille) ; `date` départage une œuvre diffusée
deux fois. Les autres cartes désignent leur dossier par `query` (titre exact
ou préfixe unique) ou leur œuvre par `work_id`. `--replace` autorise le
nouveau rendu des seules pages déjà enregistrées que le fichier décrit.

## `decisions.json`

```json
{"shortlist": [{"title": "…", "status": "rejected", "note": "Déjà publié en S43 (fraîcheur inter-numéros)."}],
 "documentary": {"scope": "Passe dédiée ARTE, France 5, …", "limits": ["…"], "distribution_note": "…"},
 "reminder": {"source_note": "…"},
 "reasons": {"Titre du documentaire ou de la critique": "Non retenu : …", "/reviews/12": "Non retenu : …"}}
```

`shortlist` ajoute les rejets et reports à la présélection. `coverage-pass`
place mécaniquement chaque documentaire et chaque critique retenus dans les
pools (par titre, titre imprimé du créneau ou créneau) ; toute autre décision
est un motif de `reasons`. Tant qu'une critique ou un documentaire examiné
n'a pas de décision, la commande liste les manques et n'écrit rien.
