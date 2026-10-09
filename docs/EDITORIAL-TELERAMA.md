# Import facultatif d'un magazine Télérama

Le magazine fourni complète la découverte et, à partir de S43, constitue le
point de départ des premières suggestions de la présélection. Sur décision de
l’utilisateur, sa grille est la référence des titres imprimés, chaînes, jours
et heures pour la cible après revue de transcription. Le parcours courant
continue sans PDF. L’import seul ne sélectionne aucune œuvre, ne coche aucun
flag et ne certifie ni une transcription ni la couverture.

## Portée de l’autorité

Appliquer `schedule_authority` dans `data/editorial-config.json` et la règle de
`AUTOMATION.md`. Le lot expose une référence de grille avec les pointeurs PDF ;
les anciennes valeurs Web restent disponibles. Une extraction incertaine demande
une lecture de page, pas une nouvelle grille indépendante pour confirmer la
ligne lisible. Les flags techniques anciens `requires_title_review` et
`requires_broadcast_confirmation` ne demandent plus, dans ce périmètre, une
seconde preuve de diffusion : la revue de la ligne imprimée fournit la référence.

L’inventaire Web garde ses lignes, URLs et comptes réellement relevés. Une
référence PDF est un pointeur de papier ; ne pas fabriquer une URL Web pour la
faire entrer dans un champ de source. Appliquer ses valeurs de grille dans les
propositions revues en conservant séparément la provenance de l’arbitrage.

Le rappel des omissions reste une vraie comparaison. Consigner dans
`coverage.grid_authority_reviews` les empreintes/pages, dates/chaînes, lignes
acceptées, date de revue, omissions résolues et limites. Ne pas cocher une
indépendance EPG inconnue. Après achèvement réel de cette revue et des contrôles
hors PDF, l’arbitrage Télérama peut soutenir l’attestation globale de couverture.
Une absence dans l’extraction films/documentaires ne prouve pas une absence
dans le magazine : lire les pages utiles ou utiliser les sources ordinaires.

Les offres, expirations, versions, critique indépendante, notes, visuels et liens
restent à vérifier. Une correction officielle ultérieure sur le même événement
est enregistrée et peut remplacer l’horaire imprimé ; un simple écart d’agrégateur
reste documenté et ne déclenche pas une enquête sans fin. Sans magazine valide
pour la cible, le fonctionnement Web existant reste disponible.

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
ne le publie pas. Le rapport de grille ne recopie ni article ni critique ni
symbole de notation. Le complément éditorial ci-dessous conserve séparément
l'appréciation native et une courte paraphrase relue. Une ligne incertaine
reste rejetée et tracée, jamais reconstituée.

Les scans sans texte, autres mises en page et pages non reconnues demandent une
revue manuelle ou une préparation OCR distincte ; ils ne deviennent pas une
grille complète validée. La première nuit du samedi peut être dans le numéro
précédent ; cette limite reste visible. Les lignes retenues doivent être relues ; leur titre imprimé, chaîne, jour et
heure font alors autorité sans enquête sur le fournisseur EPG. Les corrections
officielles ultérieures datées restent consignées. Certaines ligatures du PDF peuvent
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
ne remplace pas silencieusement le relevé existant. Les correspondances au catalogue restent des identités/versions à vérifier ;
la préférence de grille ne crée ni alias canonique ni carte complète.

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

## Méthode simple depuis un nouveau chat

Pour chaque prochain magazine, ouvrir un nouveau chat **Work** dans le projet
« Sélection TV / Jellyfin », joindre le PDF et demander :

> Importe ce Télérama pour la semaine qu'il couvre dans kingrabbit89/selection-tv.
> Lis docs/EDITORIAL-TELERAMA.md sur main et applique son protocole d'import.
> Sauvegarde la grille, les appréciations et de courts résumés critiques pour
> les reprises automatiques, en conservant le fonctionnement et les contrôles actuels.
> Confirme les dates couvertes, les fichiers sauvegardés et leur disponibilité.

Le simple dépôt du PDF dans les sources du projet n'effectue pas l'import dans
GitHub. C'est cette demande d'import, puis sa sauvegarde vérifiée, qui le rend
disponible au producteur. Le nouveau chat doit disposer de l'accès GitHub utilisé
pour ce dépôt. Aucune commande ni choix d'un numéro de semaine n'est demandé à
l'utilisateur : l'assistant lit la couverture et exécute le protocole ci-dessous.

## Protocole de l'assistant d'import

1. Lire les instructions actuelles et les SHA sur GitHub. Garder la candidate
   et les baux des producteurs intacts ; préparer les sources dans un clone
   isolé de main. Installer `pdfplumber` seulement si nécessaire.
2. Préparer les deux entrées dans un dossier nouveau avec la semaine dérivée
   de la couverture (le changement de mois/année est pris en charge dans le
   format de couverture reconnu) :

```sh
python3 scripts/prepare-telerama-input.py /chemin/magazine.pdf \
  --out-dir /tmp/import-telerama-nouveau --library-file-id IDENTIFIANT_SI_DISPONIBLE
```

3. Lire `summary.json`, contrôler les grilles et les en-têtes des critiques.
   Lire réellement les pages de critique référencées. Renseigner pour chaque
   critique lisible `author`, `review_summary` (paraphrase brève, ≤ 700 caractères),
   `summary_reviewed: true`, `summary_reviewed_at` réel et `summary_basis`.
   Une critique non lue garde son résumé null et son état non revu. Corriger
   explicitement un titre dans `reviewed_title` après lecture de la page,
   sans perdre le titre brut. Ne publier aucun texte d'article ni le PDF.
4. Valider les rapports avec `validateTeleramaReport` et
   `validateTeleramaEditorial`, puis tester le rapprochement sur le SHA réel
   de la candidate avec `--telerama-report` et `--telerama-editorial`.
   Les preuves locales restent locales jusqu'à leur sauvegarde ; une source
   non reconnue reste un manque explicite. Sans checkpoint initialisé, tester
   `buildProductionPlan` en lecture seule, sans inventer un checkpoint.
5. Sauvegarder les deux rapports sous `data/editorial-inputs/YYYY-Sxx/telerama.json`
   et `telerama-editorial.json` dans une PR normale de sources, depuis main à jour.
   S'il existe déjà un import du même PDF, préserver ses résumés revus et ses
   preuves ; ne le remplacer ni par une extraction différente ni par des résumés
   null. Vérifier les blobs exacts avant de déplacer la branche ; suivre les
   protections/CI ordinaires sans contourner une approbation requise.
6. Confirmer la semaine, les comptes, les limites, le lien de PR et son état
   réel. L'import est disponible au producteur après fusion et synchronisation
   normale de sa candidate sous son propre bail. Aucun nouveau run planifié
   ni changement de cadence n'est nécessaire. Une PR non fusionnée n'est pas
   annoncée comme un import actif.

## Appréciations et critiques séparées

`editorial-telerama-editorial.py` lit les pages quotidiennes de critiques,
distinctes des grilles. Il conserve les marques natives et leur légende :
Hélas, Bof (T), Bien (TT), Très bien (TTT), Bravo (TTTT). Le glyphe et la page
restent tracés. La présence dans ces pages ne vaut pas avis favorable : les
critiques négatives ou réservées restent disponibles.

Le producteur lit automatiquement l'entrée préparée `telerama-editorial.json`
au même SHA exact que les autres données. Le lot expose les critiques par
jour/appréciation comme aide au tri, leurs résumés relus, auteurs et pointeurs.
Il joint `editorial_signals` seulement sur titre et créneau civil exacts ; les
autres critiques restent explicitement à rapprocher. Les décisions enregistrées
et le catalogue ne sont pas réécrits.

Ces avis servent à orienter les choix avec les autres critères éditoriaux.
Ils ne deviennent ni notes IMDb/SensCritique, ni consensus, ni preuves de
diffusion actuelle, ni cartes complètes. Un résumé relu n'est pas une nouvelle
consultation du diffuseur. Une seule rédaction reste une seule source.
`--without-telerama` ignore aussi ce complément éditorial.

## Premières suggestions à partir de S43

La politique `initial_suggestions` donne aux appréciations positives du
magazine fourni pour la bonne semaine la priorité pour amorcer la sélection :
Bravo (TTTT), Très bien (TTT), puis Bien (TT). Lire
`initial_editorial_suggestions` en entier, avec les auteurs, les paraphrases
relues et les pointeurs de page/empreinte. Avant toute shortlist enregistrée,
les avis rapprochés orientent réellement l’ordre initial de la file. Les avis
non rapprochés restent des pistes à investiguer (`investigate_title_and_civil_slot`),
sans transmettre leur critique à un homonyme. Une critique sans résumé reste
à lire ; Bof et Hélas restent des réserves attribuées, sans veto automatique.

Les autres sources complètent les jours, rubriques et découvertes peu couverts,
et permettent de remplacer une piste non adaptée. Les critères éditoriaux,
la passe documentaire et les contrôles des cartes restent applicables. La
présélection définitive est révisable ; les appréciations ne deviennent ni
notes IMDb/SensCritique ni consensus. Télérama ne décide pas automatiquement
du contenu publié.

Après enregistrement d’une shortlist, poursuivre les dossiers choisis et les
lacunes du numéro ; ne pas repartir de zéro ni rouvrir les rejets, reports ou
impasses sur le seul fait qu’un avis est bien noté. S42 conserve sa présélection
en cours. Sans entrée éditoriale valide ou avec `--without-telerama`, le plan
existant est inchangé.

L’amorce issue d’une entrée Git fournit `shortlist_signal`, prêt à reprendre
dans `shortlist.entries[].signals` après revue, avec
`kind`, `note`, `publisher: "Télérama"`, `source_ref: "sha256:EMPREINTE_PDF"`,
`pdf_page`, `bbox` et `provenance` : `source_sha` Git exact, chemin
`data/editorial-inputs/YYYY-Sxx/telerama-editorial.json` et pointeur
`/reviews/INDEX`. Reprendre les valeurs de l’avis réellement importé, puis
vérifier leur concordance. Aucune URL Web n’est nécessaire pour cette preuve
papier. Une extraction locale doit être importée avant de recevoir une
provenance Git ; la seule conformité du signal ne certifie ni sa lecture, ni
une identité, ni la qualité finale d’une carte.
