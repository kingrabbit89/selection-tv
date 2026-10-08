# Diagnostic de production — 8 octobre 2026

État observé sur main b02809c4d8b24c4620a9f549215269f4db32b57b et candidate S42 6fd6686f1467e6281108cb7ab83a8de6820edf36, sauvegardée à 20:10:48 Europe/Paris. Les chiffres décrivent ce checkpoint, pas une livraison ultérieure.

## Rendement et numéro

14 passages journalisés cumulent 18 590 secondes, environ 5 h 10. Cela inclut lecture, attente et écriture ; ce n'est ni du temps de calcul mesuré ni un coût en crédits. 71 lots et 723 preuves ont été sauvegardés. L'inventaire compte 2 230 occurrences sur sept jours, dont 830 documentaires. Le paquet ciblé identifie 45 dossiers effectivement recherchés. Aucun doublon exact de preuve n'a été constaté : aucun taux de recherches inutiles n'est donc annoncé.

Une seule œuvre est déclarée complète pour comparaison, Thorin. Aucune nouvelle carte complète n'est comptée dans les métriques. Le JSON hebdomadaire, les radars/réserves et la coquille S42 manquent. 35 exigences restent ouvertes ; les 21 flags de scan, recoupement et rappel ne sont pas certifiés. Le champ resume renvoie encore à une ancienne phase et un ancien main. Le principal problème est la transformation insuffisante des dossiers en livrables, avec reprises mal orientées, pas un numéro presque fini.

Les 92 correspondances de titres du catalogue ne sont pas 92 recommandations neuves : 87 sont exposées dans les quatre derniers numéros selon les catégories du contrôle de fraîcheur. Réutiliser les métadonnées et vérifier une nouvelle diffusion restent distincts de recommander à nouveau. Le minimum quotidien représente normalement 70 positions, dont 21 choix principaux ; les autres rubriques et leurs réserves s'ajoutent. Positions et œuvres distinctes ne sont pas équivalentes.

La validation des réserves S41 signale aussi une dette historique : 28/66 candidats complets, dont 12/45 réserves. Ce numéro précède le blocage strict ; son résultat vert n'atteste donc pas la complétude de toutes ses réserves. Les critères stricts S42 restent applicables, sans transformer les anciennes données incomplètes en fiches vérifiées.

## Corrections

- Consigne active réécrite et versionnée : reprise depuis les preuves, anciens resume réconciliés, priorités par jour/rubrique, production de cartes et enchaînement de lots, même bail et mêmes seuils. La cadence horaire reste un filet de reprise.
- Paquet de travail : preuves par listes de titres, aliases, chaînes/dates et observations officielles ; portée des impasses respectée ; pagination ; historique ; JSON compact avec limites explicites.
- Rendu mécanique de décisions explicites : plusieurs fiches deviennent catalogue/liens/cartes/pools/grilles et coquille draft via un handoff contrôlé. Aucun titre, rang, texte ou preuve n'est inventé ; latest demeure inchangé.
- Contrôles lourds du public réutilisés seulement sur préparation limitée aux trois checkpoints et preuve exacte récente de main. La barrière de fusion et tous les contrôles de la candidate complète demeurent.
- Événements inutiles du publicateur filtrés pour les branches techniques ; calendrier et lancement manuel conservés.
- Titres HTML décodés une seule fois dans les contrôles d'identité, images, fraîcheur et historique. Apostrophes, guillemets et esperluettes restent échappés dans le rendu, avec comparaison correcte aux titres canoniques.

## Vérification et limites

Le dossier compact Thorin passe de 25 964 à 17 595 octets (environ 32 %), l'aperçu de 21 286 à 19 538 octets (environ 8 %) malgré davantage de contexte. Ce sont des tailles de sortie, pas une économie de quota démontrée. Un plan Thorin rendu sur le SHA exact produit un handoff de cinq fichiers de brouillon, conserve toutes les exigences et reste explicitement non finalisé/non prêt. Ce test ne vaut ni application à la candidate ni sélection comparative terminée.

La couverture indépendante de certaines chaînes, les conflits de grilles et versions, la comparaison critique, la majorité des fiches et toutes les rubriques incomplètes restent du travail éditorial réel. L'optimisation ne garantit pas une date de livraison ; son rendement doit être observé sur les prochains passages via cartes effectivement sauvegardées, exigences résolues et motifs d'arrêt.
