# Transformer les décisions éditoriales en brouillon

`editorial-work-packet.mjs` rassemble les preuves ; il ne rédige ni ne classe les
propositions. `editorial-draft-cards.mjs` évite ensuite de recopier manuellement
une même décision dans le catalogue, les liens, une carte HTML, un pool et une
ligne de grille. Il traite plusieurs fiches revues dans un seul appel.

Le producteur décide lui-même des identités, versions, titres retenus, rangs,
synopsis et justifications. Aucun score, titre ou métadonnée n'est déduit par
l'outil. Une correspondance de titre avec le catalogue n'autorise pas la réutilisation.

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

## Résultat et limites

Le paquet conserve le schéma public actuel. Il peut créer une semaine **draft**
partielle, son entrée de manifeste et sa coquille, ou compléter un brouillon.
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
