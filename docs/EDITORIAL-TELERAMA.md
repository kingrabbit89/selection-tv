# Import facultatif d'un magazine Télérama

Le magazine fourni complète la découverte et la vérification des programmes.
Le parcours courant continue sans PDF. L'import ne remplace pas l'inventaire Web,
ne sélectionne aucune œuvre, ne coche aucun flag et ne certifie aucune diffusion.

## Un PDF fourni

L'extraction locale utilise Python3 et `pdfplumber` (version testée : 0.11.9).
Cette dépendance est nécessaire uniquement pour lire un nouveau PDF ; les
rapports déjà extraits se reprennent avec les outils Node existants.
`pdftotext` (Poppler), s'il est disponible, accélère le repérage des pages ;
les faits et les positions restent extraits par `pdfplumber`.

```sh
python3 -m pip install pdfplumber==0.11.9
node scripts/editorial-production-flow.mjs YYYY-Sxx --ref SHA_CANDIDATE \
  --out-dir /tmp/lot-avec-magazine --telerama-pdf /chemin/magazine.pdf
```

Le PDF doit correspondre à la semaine samedi-vendredi de la cible. Un PDF texte
avec les bandeaux et polices du format vérifié est pris en charge. Le parseur
déduplique les glyphes, sépare les colonnes et les sections de chaînes, relève
les titres factuels en gras marqués film/documentaire et reporte les horaires
après minuit au jour civil suivant. Le PDF d'origine est conservé ; l'outil
ne le publie pas. Les articles, critiques et symboles de notation ne sont pas
recopiés. Une ligne incertaine reste rejetée et tracée, jamais reconstituée.

Les scans sans texte, autres mises en page et pages non reconnues demandent une
revue manuelle ou une préparation OCR distincte ; ils ne deviennent pas une
grille complète validée. La première nuit du samedi peut être dans le numéro
précédent ; cette limite reste visible. Les horaires retenus et l'indépendance
réelle des sources restent à confirmer. Certaines ligatures du PDF peuvent
perdre une lettre : `requires_title_review` impose une revue du titre avant
son rapprochement définitif.

Le dossier contient `telerama-report.json`, le lot rapproché du catalogue et un
`telerama-handoff.json` s'il y a un supplément nouveau. Le rapport conserve
l'empreinte, la taille et le nombre de pages du PDF, les pages/rectangles des
observations, la date de grille et les dates civiles. La publication du magazine,
l'extraction et l'import sont distincts d'une consultation du diffuseur : aucune
date `checked_at` ni URL Web n'est inventée.

## Réemploi d'une extraction

```sh
node scripts/editorial-production-flow.mjs YYYY-Sxx --ref SHA_CANDIDATE \
  --out-dir /tmp/lot-avec-extraction --telerama-report /chemin/telerama-report.json
```

Après revue de l'extraction, son handoff peut être importé sous bail sur sa base
exacte avec les mêmes contrôles et empreintes que les autres checkpoints :

```sh
node scripts/editorial-handoff.mjs check /tmp/lot-avec-extraction/telerama-handoff.json
node scripts/editorial-handoff.mjs apply /tmp/lot-avec-extraction/telerama-handoff.json
```

Il ajoute uniquement `research.supplementary_sources`, sans changer les autres
champs du checkpoint. Exigences restantes, métriques, preuves, inventaire,
couverture, cartes, catalogue et manifeste sont conservés. Une recherche déjà
scellée ou prête refuse un nouvel import. Le même PDF est idempotent ; une
extraction différente du même PDF exige de revoir le supplément existant.

Les passages suivants chargent les observations sauvegardées au SHA exact avec
leurs pointeurs de page, sans relire le PDF et sans accès réseau supplémentaire.
Un titre différent au même créneau devient une contradiction à examiner ; il
ne remplace pas silencieusement le relevé existant. Les correspondances au
catalogue restent des pistes à vérifier, avec tous les contrôles ordinaires.

## Entrée préparée et parcours sans magazine

Une extraction relue peut aussi être sauvegardée comme entrée facultative
`data/editorial-inputs/YYYY-Sxx/telerama.json`. Le producteur la joint alors aux
lots en lecture seule depuis le Git exact, sans écrire sur une candidate occupée.
La présence de ce fichier matérialise le PDF fourni pour cette semaine ; aucune
tâche ne l'exige pour commencer ou continuer. Si le même PDF est déjà sauvegardé
dans la recherche, il n'est pas joint une seconde fois.

```sh
node scripts/editorial-production-flow.mjs YYYY-Sxx --ref SHA_CANDIDATE \
  --out-dir /tmp/lot-sans-magazine --without-telerama
```

Cette option ignore le supplément dans le lot et conserve tous les fichiers et
preuves sauvegardés. Sans PDF, entrée préparée ou supplément de recherche, le
plan de travail est identique au parcours précédent. La cadence, le budget,
les seuils et la publication protégée gardent leurs règles actuelles.
