# Bail éditorial court — production pilotée dans Chat

Le mode Chat, lancé manuellement, n'est pas une tâche planifiée. Ce document complète `docs/HYBRID-WORKFLOW.md` sans modifier les seuils éditoriaux, les contrôles GitHub, la fenêtre de publication ni les protections de `main`.

## À quel moment verrouiller ?

1. **Sans bail** : lecture de `main` / `auto/YYYY-Sxx`, Télérama et sources publiques ; tri, comparaison, préparation locale des cartes, handoff, prévalidation. Les fichiers restent préparatoires tant que le transfert n'a pas été commité.
2. **Juste avant un lot d'écritures sur la candidate** : vérifier la tête, l'éventuel propriétaire du bail `locks/editorial-YYYY-Sxx`, et l'absence de tâche en train d'écrire ; acquérir la propriété avec un owner unique et une durée de dix minutes. L'acquisition échoue si le bail tiers est encore valide. Ne pas tourner en boucle, le détruire ni forcer une référence.
3. **Pendant le lot** : confirmer propriétaire et expiration immédiatement avant **chaque** écriture ou fusion sur la candidate, y compris au retour d'une opération longue ; renouveler avec le même owner avant l'expiration si l'intégration doit durer plus de cinq minutes. Un bail expiré ou perdu entraîne l'arrêt des écritures et une réconciliation de la nouvelle tête, pas la poursuite sur une ancienne base.
4. **Dès la fin du lot ou sur erreur** : libérer immédiatement si le bail est encore actif et appartient au même owner. Un bloc `finally` est préférable ; ne jamais libérer le bail d'une autre exécution. Si le processus est interrompu et n'exécute pas sa libération, l'expiration au bout de dix minutes permet ensuite une acquisition normale.

Les anciens exécutants et leurs baux actifs **conservent 60 minutes** par défaut. Aucun bail déjà émis n'est raccourci rétroactivement. Les données S43 ne sont pas modifiées par cette évolution technique. Les mêmes règles de commits à parent exact, de tête relue et de références **sans force** restent impératives ; le mode Chat ne contourne pas les validations ni la chaîne de publication.

## Helper depuis un shell déjà authentifié

```sh
node scripts/editorial-lease.mjs acquire 2026-S43 --chat
# Mémoriser l'owner renvoyé (ne pas créer un nouveau UUID ensuite).
node scripts/editorial-lease.mjs check 2026-S43 OWNER
# Avant chaque écriture GitHub ; répéter et renouveler si nécessaire.
node scripts/editorial-lease.mjs renew 2026-S43 OWNER
node scripts/editorial-lease.mjs release 2026-S43 OWNER
```

Dans un script JavaScript authentifié, envelopper uniquement la transaction d'écriture :

```js
import {github} from './github-weekly-api.mjs';
import {withEditorialLease} from './editorial-lease.mjs';

await withEditorialLease(github(), {week: '2026-S43'}, async ({check, renew}) => {
  // Les recherches et la préparation du lot sont déjà terminées.
  check(); // Relecture propriétaire + expiration immédiatement avant chaque écriture.
  // ... écrire un fichier validé sur une branche candidate non divergente.
  // Pour une transaction plus longue : renew() avant expiration, puis check().
}); // Le bail est libéré même si le callback rejette ; sauf crash ou bail perdu.
```

`withEditorialLease` signale si la libération échoue : il ne doit pas masquer silencieusement une erreur de sauvegarde. Il ne fournit **pas** à lui seul une garantie transactionnelle entre le bail et la mise à jour de la candidate : le contrôle de propriétaire, l'absence de force et la réconciliation de la branche sont toujours nécessaires.

## Pousser la candidate en une commande (Claude Code ou terminal local)

Depuis un clone local où `gh auth login` a été fait et où les commits de la semaine sont déjà créés :

```sh
node scripts/push-candidate.mjs 2026-S44 --dry-run   # contrôles seuls, sans bail ni push
node scripts/push-candidate.mjs 2026-S44             # bail court, push sans force, libération
```

Le script enchaîne exactement la séquence ci-dessus : il refuse une branche `auto/YYYY-Sxx` distante qui n'est pas un ancêtre de `HEAD` (réconcilier d'abord, jamais forcer), tout chemin hors des livrables autorisés de la semaine, et, pour un checkpoint `ready`, toute empreinte `reviewed_files` qui ne correspond pas aux blobs **commités** (une copie de travail aux fins de ligne converties ne peut donc pas faire passer une revue périmée). Il acquiert ensuite un bail de dix minutes avec `withEditorialLease`, relit la tête distante, pousse `HEAD` vers `auto/YYYY-Sxx` sans force, vérifie la nouvelle tête puis libère le bail, y compris en cas d'échec du push. Un bail tiers actif bloque l'exécution. Le script ne touche ni `main` ni la promotion : la CI et le publicateur protégé restent seuls à fusionner.

## Chat avec connecteur GitHub, sans terminal Git authentifié

Appliquer les mêmes opérations à l'aide des commandes GitHub **réellement disponibles** :

- Lire `refs/heads/locks/editorial-YYYY-Sxx` et le message JSON de son commit. Vérifier `kind`, `week`, `owner`, `expires_at` et `released`. Un champ `mode: "chat"` sur les nouveaux baux indique le délai court ; son absence signifie le bail historique. Si l'état est illisible, ne pas écrire.
- Après expiration ou libération du bail antérieur, créer un commit de bail (`kind: selection-tv-editorial-lease`, semaine, nouvel owner, `mode: chat`, `expires_at` réel à maintenant + dix minutes, `released: false`), avec pour **parent exact** l'ancienne tête de cette branche et **le même arbre**. Avancer la référence sans force, puis relire le propriétaire. Si la branche n'existe pas, suivre le protocole de création depuis `main` prévu par le helper.
- Faire de même pour renouveler (owner identique, délai de dix minutes) et pour libérer (`released: true`), toujours sur la tête exacte, seulement si l'on possède encore un bail non expiré. Ne pas forcer la création ou la mise à jour si une exécution concurrente a gagné.

Le connecteur n'exécute pas automatiquement le helper local. Ne pas prétendre qu'une tentative d'acquisition, une pause de tâche ou la seule présence du commit ont libéré une ressource ; relire la tête et son message. Si la candidate a bougé pendant la préparation, **réconcilier les fichiers et leurs empreintes**, jamais remplacer une base SHA pour masquer une collision.

## Ce qu'il ne faut jamais faire

Ne pas supprimer la branche de verrou, réinitialiser la référence, utiliser `force`, acquérir un verrou tiers encore actif ou réduire rétroactivement son expiration. Ne pas confondre une expiration avec l'arrêt certain de l'ancienne exécution : tout détenteur doit recontrôler sa propriété avant d'écrire. Aucune modification de `main`, aucun merge de PR candidate incomplète et aucune publication ne résultent de l'acquisition d'un bail.
