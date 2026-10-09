# Preuves, portée des écarts et reprise des recherches

Cette politique précise les trois niveaux de `AUTOMATION.md`. Elle ne change
aucune chaîne obligatoire, aucun seuil, aucune barrière de publication et
n'atteste aucune source ou carte par elle-même.

## Grille de référence fournie par l’utilisateur

Quand un PDF Télérama correspondant à la cible est fourni, sa grille fait autorité
pour les titres imprimés, chaînes, jours et heures qu’elle couvre, après revue
de la transcription. Conserver l’empreinte du PDF, la page, la position, le texte
lu et la date réelle de revue. Ce choix de référence n’est pas une preuve
d’indépendance EPG et n’en nécessite pas une pour ces quatre faits.

La seconde lecture des omissions compare réellement l’inventaire avec cette
référence. Conserver les jours/chaînes/nuits relus, omissions et limites dans
`coverage.grid_authority_reviews`. Ne pas déclarer une indépendance inconnue ;
l’arbitrage PDF peut néanmoins achever cette revue sur son périmètre. Une
ancienne impasse portant uniquement sur la provenance d’un horaire ainsi relu
ne reste pas une condition de publication. Les fragments ambigus et la
couverture absente demeurent ouverts. La revue globale `full_week_reaudit_completed`
est déclarée seulement après achèvement réel de tout le périmètre applicable.

Une divergence d’un agrégateur ne renverse pas seule la référence. Conserver
les valeurs et appliquer celle du PDF à la grille retenue après revue ; ne pas
certifier un créneau Web divergent non retenu. Une correction officielle
ultérieure, précise et datée pour le même événement peut prévaloir, avec sa
preuve et son motif conservés. Deux PDFs contradictoires ou une identité/version
ambiguë imposent une revue, pas un choix automatique.

Cette autorité ne s’étend ni aux offres replay, expirations, images ou critiques,
ni aux métadonnées/version non prouvées par la ligne. Sans PDF pour la cible,
le parcours Web ci-dessous permet de terminer sans attendre de magazine.

## Évaluer les sources

Pour chaque recoupement, conserver les URLs ou captures réellement lues, leur
date de consultation, les dates et chaînes couvertes, le flux géographique,
les faits comparés et les limites. Distinguer trois conclusions :

| Conclusion | Preuve et conséquence |
|---|---|
| Indépendance établie | Expliquer une base positive de provenance ou d'acquisition distincte et sa portée. |
| Flux commun établi | Conserver la preuve de cette dépendance ; ces deux reprises ne comptent pas comme deux sources. |
| Provenance inconnue | Conserver l’incertitude ; elle ne bloque pas seule le recoupement concordant ou la revue des omissions décrits ci-dessous. Ne certifier ni indépendance ni flux commun. |

Le nom public du fournisseur EPG n'est pas une condition universelle. La base
positive peut être une provenance publiée, une acquisition originale documentée
ou une observation primaire du diffuseur portant sur le fait à vérifier. Une
capture de guide copiant des données n'est pas, par elle-même, une acquisition
originale indépendante. Un autre domaine, éditeur, distributeur, des horaires
concordants ou des différences isolées ne prouvent pas seuls l'indépendance.

Consigner la conclusion avec `source_urls`, `checked_at`, `scope`, `basis` et
`limitations` dans les preuves de couverture. L'existence d'une fiche opérateur
peut vérifier un fait relevant de sa propre offre ; elle ne garantit pas
l'origine indépendante de tous ses horaires. La portée de chaque preuve compte.

Le niveau 2 est une seconde lecture des jours, chaînes et nuits pour détecter
les omissions. Il ne demande pas de certifier individuellement chaque créneau
brut. Une chaîne/date/nuit réellement non relue reste une lacune bloquante.
Une provenance inconnue ne devient pas une seconde source indépendante. Elle ne bloque pas seule la revue des omissions, avec ou sans PDF. La seconde lecture compare réellement les grilles complètes au relevé, en utilisant un autre guide lorsqu’il est accessible et en consignant les limites d’une lecture de référence unique. Les jours, chaînes et nuits non lus restent des lacunes réelles.

Au niveau 3, les quatre faits imprimés d’une ligne du PDF fourni peuvent être
acceptés après revue de transcription selon la règle précédente. Hors de ce
périmètre, une diffusion est vérifiée par une preuve officielle exacte ou par
deux guides actuels d’éditeurs distincts réellement lus et concordants sur
titre, chaîne, date et heure du même événement et du bon flux géographique.
Une provenance technique inconnue reste consignée ; cette nouvelle voie est
un recoupement concordant, pas un certificat d’indépendance. Un flux commun
démontré compte une seule référence. Une correction officielle exacte et
datée prévaut ; tout écart matériel reste à résoudre ou la carte à remplacer. Une preuve peut se composer de
plusieurs pièces complémentaires si elles désignent exactement le même événement
et la même identité/version : expliciter les liens et les champs réellement
prouvés. Ne jamais exiger sans justification que tous les champs soient réunis
dans un unique objet JSON. Un rapprochement de titre, une attribution de chaîne
générale ou un horaire concordant sans lien démontré ne suffit pas à compléter
un champ officiel absent.

## Achever la revue Web sans magazine

La configuration `web_schedule_evidence` introduit explicitement la voie de
recoupement concordant à partir de S42. Deux guides peuvent reproduire la
même erreur ; enregistrer cette limite et rechercher une correction officielle
si un écart ou une anomalie l’exige, sans prétendre avoir prouvé leur indépendance.
La disponibilité de Télérama ou d’une provenance EPG publiée n’est plus une
condition de clôture.

La seconde lecture des omissions couvre réellement jours, chaînes et nuits.
Consigner dans `coverage.web_schedule_reviews` : dates, chaînes, flux, URLs ou
captures, dates réelles de consultation et de revue, segments relus, comparaison
avec l’inventaire, omissions examinées, décisions motivées et limites. Comparer
un autre guide lorsqu’il est accessible. Avec une seule grille complète pour
une chaîne, relire son contenu contre l’inventaire lors d’une revue distincte
de l’extraction et documenter cette portée ; aucune page ou nuit manquante
n’est déclarée couverte. Le rappel éditorial utilise les sources critiques et
les découvertes disponibles, sans exiger un magazine ou des notes indisponibles.

Garder `independent_crosscheck_complete` faux si l’indépendance est inconnue.
Déclarer `full_week_reaudit_completed` uniquement après achèvement réel de toute
la revue applicable, avec la méthode et ses limites sauvegardées. Les autres
champs, quotas, offres, versions, visuels, liens et contrôles de publication
conservent leurs exigences. Une ancienne attente portant uniquement sur
l’amont technique est réconciliée sur cette règle ; les manques factuels et
les segments non lus demeurent dans `remaining`.

Pour une carte dont les faits ne sont pas suffisamment établis après recherche
ciblée et alternative distincte, constituer et intégrer un remplacement vérifié
pour son emplacement. Ne pas suspendre tout le numéro sur une proposition
remplaçable, ni retirer une vraie exigence sans preuve ou remplacement.

## Revoir l'impact des écarts

Avant de qualifier une anomalie de bloquante, consigner une revue d'impact :
faits en conflit, preuves, dates/chaînes, œuvres et emplacements concernés,
effet sur l'identification ou une omission possible, conclusion motivée.

| Portée constatée après revue | Traitement |
|---|---|
| Carte retenue, réserve ou ligne commentée affectée | Résoudre le défaut ou remplacer la proposition par une alternative entièrement vérifiée. |
| Chaîne, date, nuit ou omission réelle non couverte | Achever la couverture ; la lacune reste bloquante. |
| Divergence brute conservée, sans effet démontré sur une proposition, une omission ou la couverture | Conserver une note sourcée avec sa limite ; elle ne bloque pas seule la publication. |
| Impact inconnu | Examiner l'impact ; aucune clôture automatique. |

Une absence de carte sélectionnée ne suffit pas à exclure une lacune de
couverture. Une note informative ne certifie pas l'horaire litigieux. Les lignes
brutes et les contradictions restent conservées. Une piste réellement examinée
et écartée peut être clôturée sur décision motivée ; une simple attente ne vaut
pas rejet. Réconcilier ensuite `remaining` et, s'il existe, `remaining_items`
sans perdre une exigence encore applicable.

Une fenêtre EPG et une durée canonique mesurent des choses différentes. Leur
écart ne démontre pas seul un montage différent ; leur proximité ne certifie
pas non plus la copie. Un identifiant de master n'est pas une exigence
universelle. Vérifier l'identité/version sur les preuves pertinentes, conserver
les valeurs avec leur portée et remplacer la carte si une contradiction
matérielle demeure. Ne pas inventer une coupe, une conversion de cadence ou
une consultation pour résoudre l'écart.

## Suspendre une recherche qui attend un fait nouveau

Après une tentative ciblée et une voie alternative distincte sans réponse,
conserver le dossier et sa condition concrète de reprise dans
`research_attempts`. Si la revue confirme que la prochaine recherche attend
une preuve nouvelle, ajouter un `retry_gate` :

```json
{
  "state": "waiting_for_new_evidence",
  "action_texts": ["Texte exact d'une action conservée dans le checkpoint"],
  "reason": "Pourquoi une nouvelle consultation sans fait nouveau ne répondrait pas à la question",
  "resume_when": "Fait précis qui rendra la recherche de nouveau utile",
  "observed_at": "Date ISO réelle de la revue",
  "evidence": "Pointeur et résultat réellement sauvegardés"
}
```

`action_texts` reprend exactement les textes de `remaining`, de
`resume.next_actions` ou du prochain lot du passage courant. Annoter également
les renvois exacts à la même impasse s'ils existent, après revue ; l'outil ne
devine aucun lien par proximité de mots. Il conserve les annotations invalides
ou non rapprochées comme avertissements à revoir.

Pour rouvrir, conserver l'historique et passer `state` à `reopened`, avec
`new_evidence` et `reopened_at` réellement observés. La preuve répond à la
condition ; une autre URL sans résultat pertinent ou un nouveau passage ne
suffit pas. Si une même action attend encore un autre fait requis, elle reste
en attente malgré la réouverture d'un seul dossier.

```sh
node scripts/editorial-research-triage.mjs YYYY-Sxx --ref SHA_CANDIDATE --started-at DEBUT_REEL_ISO --json /tmp/research-triage-ID_PASSAGE-ID_REVUE.json
```

Remplacer les identifiants, fournir le début réel du passage courant et utiliser
un chemin neuf. Sans rapprochement exact avec ce début, aucun ancien lot
inachevé ne devient le lot courant. Une réouverture ultérieure conserve l’état
d’attente lors d’un audit antérieur à `reopened_at`. Ce rapport lit un
checkpoint immuable et ne modifie aucun fichier de candidate. Il conserve
`all_actions` et affiche `actionable_actions`, `waiting_actions` et les
`review_warnings`. Sans annotation valide, une question reste à examiner.

Les révisions `production-proof-policy-2026-10-09` et
`production-telerama-authority-2026-10-09` et
`production-telerama-first-suggestions-2026-10-09` et
`production-web-evidence-2026-10-09` du contrôleur privilégient le
prochain lot du passage courant et proposent les actions accessibles. Les
attentes demeurent visibles et les exigences demeurent dans `remaining`.
Leur suspension ne vaut ni résolution, ni attestation de couverture, ni
autorisation de publier. Les révisions historiques gardent leur comportement.

Si tout semble attendre une preuve, revoir les annotations et chercher les
alternatives accessibles. Un arrêt « toutes les tâches bloquées » exige encore
les observations réelles de ce passage couvrant toute la liste, y compris les
attentes et les exigences déclarées. Le registre historique ne remplace jamais
l'horloge, le bail, cette revue courante ou la validation finale.
