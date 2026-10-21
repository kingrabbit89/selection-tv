# Audit de production : S42, S43 et S44

Audit rédigé le 21 octobre 2026 après la publication de S44. Il s'adresse au
producteur en mode passages (ChatGPT, tâche planifiée ou Chat) et à
l'utilisateur. Il explique pourquoi S44 a été publié en moins de deux heures
alors que S42 et S43 ont demandé plus d'une journée et demie. Les chiffres
viennent des `run_metrics` sauvegardés sur `main`, de l'historique Git et des
exécutions GitHub. Ce ne sont pas des mesures de calcul ni de coût.

## 1. Constat chiffré

| Numéro | Producteur | Premier travail | Site public | Écoulé |
|---|---|---|---|---|
| S42 | ChatGPT, passages de 50 min | 8 oct. 08:03 | 10 oct. 02:11 | **42 h 08** |
| S43 | ChatGPT (passages puis Chat), achevé par Claude Code | 15 oct. 08:02 | 16 oct. 21:05 | **37 h 03** |
| S44 | Claude Code, session continue | 21 oct. 15:20 (PDF reçu) | 21 oct. 17:13 | **1 h 53** |

Heures de Paris. Les trois numéros ont un volume comparable : 30 pages pour
S43 et S44, 32 pour S42 ; 100 cartes de pools pour S43, 98 pour S44.

Détail de S44 :

| Étape | Heure |
|---|---|
| PDF reçu | 15:20 |
| PR de sources [#91](https://github.com/kingrabbit89/selection-tv/pull/91) fusionnée | 15:38 |
| Candidate scellée poussée ([#92](https://github.com/kingrabbit89/selection-tv/pull/92)) | 16:22 |
| Candidate fusionnée par le publicateur | 16:49 |
| Promotion [#94](https://github.com/kingrabbit89/selection-tv/pull/94) fusionnée, `latest.html` sur S44 | 17:13 |

Sur les 51 minutes entre la poussée et le site public, environ 30 sont dues à
deux incidents d'outillage, décrits au § 5. Sans eux, la chaîne de publication
prend le quart d'heure mesuré sur S43.

Détail de S43 (`data/research/2026-S43.json`) :

- **15 octobre** : 14 passages de ChatGPT entre 08:02 et 21:45, soit environ
  11 h 40 de passages. Les 14 s'arrêtent sur `budget_reserve_reached` ; un
  quinzième commence à 21:56 et n'a pas de fin enregistrée.
- **16 octobre** :
  - deux reprises dans Chat, de 12:16 à 18:38 ;
  - une session Claude Code à partir de 19:49, qui termine le numéro ;
  - candidate fusionnée à 20:56.

Détail de S42 ([post-mortem](production-postmortem-2026-S42.md)) : le
diagnostic du 8 octobre relève 14 passages, 5 h 10 enregistrées, 723 preuves
et **aucune nouvelle carte complète**. Trois passages de clôture du 9 octobre
totalisent 152 minutes sans faire bouger le stock de cartes.

## 2. Ce qui n'est pas comparable

La comparaison n'est pas à armes égales. S44 a profité d'outils et de
décisions que S42 et S43 n'avaient pas :

| Ajout | PR | Date |
|---|---|---|
| `push-candidate.mjs` : push sous bail en une commande | #78 | 16 oct. |
| Grille imprimée du Télérama comme inventaire (à partir de S44) | #80 | 16 oct. |
| Publication dès que la candidate est validée, sans fenêtre du vendredi | #81 | 16 oct. |
| Résolveur d'affiches et copies WebP | #82 | 16 oct. |
| Mode session continue et preuves compactes | #84 | 17 oct. |
| Résolveur de métadonnées depuis les fiches exactes | #85 | 17 oct. |

Plusieurs de ces outils ont été construits à partir des difficultés constatées
sur S42 et S43. L'écart ne vient donc pas seulement de la qualité du
producteur. Il reste que, à outils égaux, une grande partie du temps de S42 et
S43 a été dépensée sur des tâches sans effet sur le numéro (§ 3 et 4).

## 3. D'où vient l'écart, par ordre d'impact

### 3.1 Le relevé Web des grilles (environ 6 à 7 h sur S43)

Sur les 14 passages de S43, 8 ont surtout servi à relever des grilles Web,
chaîne par chaîne, puis à les relire. Exemples tirés des `completed_batches` :

- « Ajout de 79 observations du 20 octobre depuis trois grilles Web
  complètes et datées : TV5MONDE, Canal+ Box Office et Canal+ Grand Écran » ;
- « secondes lectures Canal+ Grand Écran des 21 au 23 octobre : 13/13, 14/14
  et 13/13 départs concordants » ;
- « France 5 : 35 omissions relues importées dans l'inventaire (12 émissions
  nommées et 23 lignes Imprévus) ».

Ces relectures n'ont changé aucune proposition publiée. Sur S44, la même
étape a pris 14 minutes : l'inventaire est extrait de la grille du PDF
(3 481 lignes, 51 chaînes), puis un sous-agent fait la revue de transcription
par sondage (7 pages entières, 53 lignes, 44 titres corrigés, 4 lignes
ajoutées).

### 3.2 Des passages de 50 minutes qui repartent de zéro

Chaque passage relisait les contrats, prenait et renouvelait le bail,
sauvegardait toutes les dix minutes et consultait le contrôleur de poursuite.
Il tenait aussi à jour des journaux qu'aucun outil ne lit : `closure_decisions`,
`remaining_history`, `documentary_pass_log`, `contract_read_history`. Le
passage s'arrêtait ensuite sur la réserve de cinq minutes, souvent au milieu
d'un lot.

Sur S43, les 14 passages terminés s'arrêtent sur `budget_reserve_reached`,
et le champ `next_useful_batch` repousse le travail au passage suivant. Le
mode session continue (#84) supprime ce coût fixe : une seule session, une
seule entrée `run_metrics`, des commits locaux et une seule écriture distante
par `push-candidate`.

### 3.3 Aucun parallélisme

Un seul agent faisait tout, une œuvre après l'autre. Sur S44, sept sous-agents
de recherche en lecture seule ont travaillé en parallèle : films par jours,
documentaires, rubriques hors grille et radars. Un huitième a fait la revue de
transcription. Le rédacteur intégrait les dossiers dès leur arrivée. La
recherche d'environ 120 œuvres a pris entre 8 et 36 minutes d'horloge selon
l'agent, au lieu de plusieurs passages.

### 3.4 Pas d'exécution locale

En passages, ChatGPT travaillait par le connecteur GitHub, sans shell. Chaque
contrôle supposait un aller-retour par la CI, de plusieurs minutes. Sur S44,
les validateurs tournent en quelques secondes et `validate-layout` en environ
une minute. L'aperçu `?preview=1` s'ouvre dans le navigateur intégré. Une
erreur, par exemple la page radar-2 qui déborde, se corrige en une boucle
locale de deux minutes.

### 3.5 Métadonnées et affiches saisies à la main

Sur S44, `work-resolver.mjs` remplit année, réalisateur, pays, durée, genre et
note SensCritique depuis les fiches exactes, et `poster-resolver.mjs` trouve et
contrôle les affiches. Ces deux outils ont traité les quelque 120 œuvres en
une dizaine de minutes d'exécution cumulée. Avant ces outils, chaque fiche se
remplissait à la main, page par page.

### 3.6 La surenchère de preuves

S42 a passé du temps sur des enquêtes de provenance EPG et sur l'exigence de
deux guides indépendants pour chaque horaire. Des dossiers en prose
(`research_dossiers`) recopiaient les faits. Des précautions comme « aucune carte
n'est affirmée sans rendu mécanique » (S43) retardaient la production des
cartes sans la sécuriser davantage. Depuis S44, la grille relue du PDF fait autorité
sur ses quatre faits imprimés, et chaque preuve est un enregistrement compact
de `verification_records`.

### 3.7 La fenêtre du vendredi

S42 et S43 ne pouvaient être publiés qu'à partir du vendredi 20 h. Depuis #81,
une candidate scellée et verte est publiée aussitôt, quel que soit le jour.

## 4. Comportements de ChatGPT à ne pas reproduire

Ces constats portent sur des faits enregistrés. Ils ne jugent ni la qualité
éditoriale finale de S42 et S43, ni le modèle en général.

1. **Produire des preuves au lieu de produire des cartes.** S42 : 14 passages,
   723 preuves, aucune nouvelle carte complète au 8 octobre au soir. Un passage
   qui ne sauvegarde ni carte ni exigence close doit changer de stratégie au
   passage suivant, pas recommencer.
2. **Relire des grilles qui n'affectent aucune proposition.** Une seconde
   lecture exhaustive par chaîne et par nuit n'est pas demandée quand la
   grille du PDF fait autorité : la revue de transcription par sondage suffit
   (`coverage.grid_inventory.transcription_review`).
3. **Tenir des journaux que personne ne lit.** Les quatre journaux cités au
   § 3.2 n'alimentent aucun outil ni validateur. AUTOMATION.md (#84) les
   déclare inutiles.
4. **S'arrêter sur la réserve de temps au milieu d'un lot.** Il vaut mieux
   intégrer un lot plus petit et terminé qu'un gros lot laissé au passage
   suivant.
5. **Laisser des métriques incohérentes.** Plusieurs entrées S43 déclarent
   `complete_cards_added: 0` alors que leurs `completed_batches` décrivent des
   cartes rédigées. Sans mesure fiable, personne ne peut piloter la
   production.
6. **Ne pas escalader.** Le 15 octobre, après une journée de passages, le
   numéro n'était pas prêt. Il a fallu les reprises du 16 dans Chat, puis
   Claude Code.

## 5. Les défauts de S44, pour être complet

- **Limite du publicateur.** Il refusait toute PR de 100 fichiers ou plus et
  n'a pas pu fusionner la candidate, qui comptait 120 fichiers avec ses
  110 affiches WebP. Corrigé par [#93](https://github.com/kingrabbit89/selection-tv/pull/93).
  Coût : environ 18 minutes.
- **Contrôle GitHub figé.** Sur la PR de promotion, `data-and-policy` était
  terminé mais restait affiché « en cours ». Il a été relancé à la main ; une
  relance automatique par le publicateur est en préparation. Coût : environ
  13 minutes.
- **Notes IMDb absentes.** IMDb bloque les robots : les notes affichées sont
  celles de SensCritique, et les identifiants IMDb viennent de Wikidata.
- **Pistes écartées en cours de route.** Il a fallu retirer six œuvres déjà
  publiées en S40 ou S41 (fraîcheur), ainsi qu'un homonyme (*Copie conforme* de
  Dréville, 1947, et non de Kiarostami) et une œuvre sans fiche exacte.
- **Phases approximatives.** Dans `run_metrics`, les phases se chevauchent et la
  phase `sections` a été ouverte tard. Les neuf premières minutes d'import
  précèdent le démarrage de l'horloge.
- **Qualité non contre-vérifiée.** Aucune revue éditoriale indépendante n'a
  relu S44 après coup. Les validateurs ne certifient pas la valeur des textes.

## 6. Consignes pour le mode passages

Le mode normal est désormais la session continue (Claude Code, dès réception
du PDF). Si ChatGPT doit reprendre un numéro en passages, il applique ces
consignes :

1. **Lire le checkpoint et le dernier `run_metrics`**, puis reprendre le
   prochain lot utile. Ne relire que les contrats modifiés depuis.
2. **Ne relever aucune grille Web** si `data/editorial-inputs/YYYY-Sxx/telerama.json`
   existe pour la cible. L'inventaire vient de
   `scripts/editorial-telerama-grid-inventory.mjs`, puis de la revue par
   sondage. Le Web ne sert qu'à vérifier une piste hors du périmètre imprimé.
3. **Viser des cartes à chaque passage.** Partir de la présélection, regrouper
   jusqu'à huit titres dans `editorial-work-packet.mjs`, puis rendre un seul
   plan avec `editorial-draft-cards.mjs`. Un passage sans carte ni exigence
   close doit le dire et changer d'approche.
4. **Utiliser les résolveurs** (`work-resolver.mjs`, `poster-resolver.mjs`)
   par le workflow de préparation plutôt que la saisie manuelle.
5. **Une preuve, un enregistrement compact.** Pas de prose, pas de journal
   additionnel.
6. **Escalader tôt.** Si un numéro n'est pas prêt la veille de l'échéance, le
   signaler à l'utilisateur pour une reprise en session continue, plutôt
   qu'enchaîner des passages.

## 7. À suivre sur S45

- Mesurer chaque phase dans `run_metrics`, en ouvrant les phases au bon moment.
- Vérifier que le publicateur passe seul une candidate de plus de 100 fichiers
  (#93) et relance seul un contrôle figé, une fois ce correctif fusionné.
- Garder la cible : environ 1 h de production et 15 minutes de chaîne de
  publication après réception du PDF.
