# Preuves, portée des écarts et reprise des recherches

Cette politique précise les trois niveaux de `AUTOMATION.md`. Elle ne change
aucune chaîne obligatoire, aucun seuil, aucune barrière de publication et
n'atteste aucune source ou carte par elle-même.

## Évaluer les sources

Pour chaque recoupement, conserver les URLs ou captures réellement lues, leur
date de consultation, les dates et chaînes couvertes, le flux géographique,
les faits comparés et les limites. Distinguer trois conclusions :

| Conclusion | Preuve et conséquence |
|---|---|
| Indépendance établie | Expliquer une base positive de provenance ou d'acquisition distincte et sa portée. |
| Flux commun établi | Conserver la preuve de cette dépendance ; ces deux reprises ne comptent pas comme deux sources. |
| Provenance inconnue | Conserver l'incertitude et rechercher une base positive différente ; ne certifier ni indépendance ni flux commun. |

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
Une provenance inconnue ne devient pas une seconde lecture certifiée.

Au niveau 3, une diffusion doit toujours être vérifiée par une source officielle
ou deux grilles dont l'indépendance est établie. Une preuve peut se composer de
plusieurs pièces complémentaires si elles désignent exactement le même événement
et la même identité/version : expliciter les liens et les champs réellement
prouvés. Ne jamais exiger sans justification que tous les champs soient réunis
dans un unique objet JSON. Un rapprochement de titre, une attribution de chaîne
générale ou un horaire concordant sans lien démontré ne suffit pas à compléter
un champ officiel absent.

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

La révision `production-proof-policy-2026-10-09` du contrôleur privilégie le
prochain lot du passage courant et propose les actions accessibles. Les
attentes demeurent visibles et les exigences demeurent dans `remaining`.
Leur suspension ne vaut ni résolution, ni attestation de couverture, ni
autorisation de publier. Les révisions historiques gardent leur comportement.

Si tout semble attendre une preuve, revoir les annotations et chercher les
alternatives accessibles. Un arrêt « toutes les tâches bloquées » exige encore
les observations réelles de ce passage couvrant toute la liste, y compris les
attentes et les exigences déclarées. Le registre historique ne remplace jamais
l'horloge, le bail, cette revue courante ou la validation finale.
