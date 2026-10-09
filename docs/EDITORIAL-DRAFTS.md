# Transformer les décisions éditoriales en brouillon

`editorial-work-packet.mjs` rassemble les preuves ; il ne rédige ni ne classe les
propositions. `editorial-draft-cards.mjs` évite ensuite de recopier manuellement
une même décision dans le catalogue, les liens, une carte HTML, un pool et une
ligne de grille. Il traite plusieurs fiches revues dans un seul appel.

Le producteur décide lui-même des identités, versions, titres retenus, rangs,
synopsis et justifications. Aucun score, titre ou métadonnée n'est déduit par
l'outil. Une correspondance de titre avec le catalogue n'autorise pas la réutilisation.

Pour préparer un lot, extraire plusieurs dossiers dans un seul appel :

```sh
node scripts/editorial-work-packet.mjs YYYY-Sxx --ref SHA_CANDIDATE --compact \
  --title "Premier titre exact" --title "Deuxième titre exact"
```

Le mode plusieurs titres accepte jusqu'à huit titres, lit une seule fois les
fichiers au même SHA et affiche le contexte partagé une fois. Chaque dossier
garde ses preuves, versions possibles, tentatives et avertissements historiques.
Un seul `--title` garde le format précédent. Achever les seuls champs manquants
ou périssables, puis réunir les cartes réellement revues dans un même plan ;
une piste bloquée ne doit pas retarder les autres.

## Utilisation

1. Sous le bail éditorial, lire le SHA actuel de la candidate et les paquets des
   œuvres prometteuses. Achever leur recherche et écrire les textes.
2. Écrire un plan JSON local avec `schema_version: 1`, `week`, `from`,
   `source_sha`, `remaining` (travail encore inachevé) et `cards`.
3. Pour chaque carte, renseigner explicitement :
   - `work_id` : identité canonique confirmée ; aucun ID automatique ;
   - `date`, `time`, `channel`, `rank`, `quality` ;
   - `summary`, `why`, et facultativement `grid_reason` ;
   - `review.checked_at` (YYYY-MM-DD), `review.evidence_urls`, et quatre notes
     précises : `identity_version`, `canonical_fields`, `current_broadcast`,
     `editorial_copy` ;
   - `work` seulement pour les champs nouveaux ou corrigés, et `links` pour
     des liens exacts nouveaux ou corrigés. Une œuvre absente du catalogue exige
     un objet `work` complet avec ID et titre explicitement attribués.
4. Rendre un paquet de transfert local :

```sh
node scripts/editorial-draft-cards.mjs 2026-S42 \
  --ref SHA_CANDIDATE \
  --input /tmp/decisions-s42.json \
  --out /tmp/draft-s42.json
node scripts/editorial-handoff.mjs check /tmp/draft-s42.json
```

Le SHA exact doit correspondre au plan. Un plan devenu ancien doit être réconcilié
avec la candidate actuelle, jamais forcé. L'outil ne modifie pas le dépôt ; il écrit
seulement le paquet demandé et affiche le rapport des revues. Le producteur applique
les fichiers et met à jour les preuves/checkpoints dans un même lot sous le bail.

## Rubriques, radars, couverture et sommaire

Le même plan peut contenir `sections`, chacune une page explicitement décidée : `kind`, `page` (1 par défaut), `header` rédigé (`kicker`, `h1`, `deck`), `target` facultatif et `cards`. Chaque carte porte le même contrôle d'identité, de champs canoniques, de visuel, de note ou raison d'absence, de lien fort et de `review` que les cartes quotidiennes, avec `rank`, `summary` et `why` rédigés.

| `kind` | Page(s) | Faits propres exigés |
|---|---|---|
| `rendezvous` | `rendezvous-1`, `rendezvous-2` (5 visibles, pool `week-card`) | `date`, `time`, `channel`, `quality` |
| `replay` | `replay-1..3` (3 par page) | `offer` : `service`, `url`, `checked_at`, `available_until` |
| `platform_free`, `platform_subscription` | `plateformes-gratuites[-N]`, `plateformes-abonnement[-N]` (3 par page) | `offer` : `service`, `url`, `checked_at`, `arrival_date` facultatif |
| `physical_release` | `sorties-physiques` (pool `release-card`) | `quality`, `release` : `date`, `format`, `editor`, `url`, `checked_at` ; `price`, `restoration`, `bonuses` facultatifs |
| `streaming_release` | `sorties-streaming` | `offer` avec `arrival_date` |
| `expiring` | `avant-disparition` | `offer` avec `last_day` |
| `radar_popularity` | `radar-torrent` ; rangs au-delà de `target` → `popular_deep` | `signal`, `signal_source_url` |
| `radar_popularity_scan` | `radar-torrent-sillonnage` → `popular_scan` | `signal`, `signal_source_url` |
| `radar_hd` | `radar-1`, `radar-2` → `hd1`, `hd2` | `added`, `added_source_url` |

Les rubriques à pool (rendez-vous, sorties physiques, radars) affichent les rangs `1..target` et gardent les suivants en réserve complète ; les autres rubriques affichent toutes leurs décisions et refusent un dépassement de capacité au lieu de comprimer la page. Une page déjà présente exige `replace_pages: ["id"]`. `section_shortages` accepte seulement une pénurie structurée (`reason`, au moins deux `searched_sources`, `verified_count` égal au nombre de cartes rendues). `shortage_reason` d'un pool n'est recopié que s'il est fourni.

`cover` (`lead_work_id`, `side_work_ids` ≤ 2, `kicker`, `h1`, `deck` rédigés) construit la couverture et `hero_image/title/meta` à partir de choix développés déjà décidés dans le brouillon : créneau, visuel et métadonnées viennent de ces fiches. `render_toc: true` (ou un sommaire existant) reconstruit mécaniquement le sommaire avec les numéros de page réels ; il ne lie que des pages existantes. `methode` (`h1`, `notes[]`) rend la page Méthode à partir de notes rédigées. Les pages sont rangées dans l'ordre canonique du magazine.

Le fichier `data/radar-reserves/YYYY-Sxx.json` est créé ou complété clé par clé ; les clés non décidées sont conservées.

Test ciblé : `node --test scripts/test-editorial-draft-sections.mjs`.

## Résultat et limites

Le paquet conserve le schéma public actuel. Il peut créer une semaine **draft**
partielle, son entrée de manifeste, sa coquille et ses réserves de radar, ou compléter un brouillon.
`manifest.latest`, les autres numéros et les dates de vérification existantes
restent inchangés. Les rangs 1 à 3 deviennent les choix développés ; les suivants
restent dans le pool. Aucun titre supplémentaire ni motif de pénurie n'est ajouté.
Les grilles contiennent seulement les propositions dotées d'un `grid_reason` écrit
par le producteur. Elles sont réparties sur deux pages au maximum, huit lignes
par page par défaut (`grid_page_size` peut réduire cette capacité). Le navigateur
reste l'autorité pour vérifier le rendu et la lisibilité des textes.

Un jour déjà présent exige `replace_days: ["samedi", ...]` et **son pool complet**
dans le nouveau plan : l'outil refuse de supprimer implicitement des décisions
existantes. `shortage_reasons` peut contenir des justifications structurées déjà
recherchées ; il ne doit jamais servir à transformer un lot provisoire en pénurie.

L'outil exige des champs canoniques exploitables, un vrai visuel avec provenance,
une note datée ou une raison d'absence spécifique, un lien d'identité fort et une
revue explicite. Ces contrôles ne certifient ni la vérité des preuves ni l'état
réseau des images. Les occurrences historiques, les autres rubriques et leurs
réserves, la couverture des sept jours, les contrôles de fraîcheur, la comparaison
éditoriale et la revue finale doivent encore être achevés par le producteur.

Le résultat est toujours `stage: "enrichment"`. Il n'achève aucun checkpoint,
ne scelle aucune revue et ne publie rien. Les validations complètes de données,
images, liens et navigateur restent obligatoires avant toute publication.

Test ciblé : `node --test scripts/editorial-draft.test.mjs`.
