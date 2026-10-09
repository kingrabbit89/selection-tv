// Informative operational view only. The declared editorial requirements remain
// authoritative: grouping validator messages never closes them or certifies ready.
const daily = 'samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi';

export function editorialReviewState(progress) {
  const current = progress?.editorial_review?.completed;
  const legacy = progress?.editorial_review_completed;
  return {declared_completed: typeof current === 'boolean' ? current : legacy === true,
    source: typeof current === 'boolean' ? 'editorial_review.completed' :
      typeof legacy === 'boolean' ? 'editorial_review_completed' : null,
    certified_by_this_report: false};
}

function actionFor(gap, index) {
  const message = String(gap.message || '');
  if (/^coverage full_week_reaudit_completed must be true$|^Full inventory-first coverage audit not completed$/i.test(message)) {
    return {id: 'coverage-full-week', title: 'Achever et attester la revue des sept jours', kind: 'coverage'};
  }
  const depth = message.match(new RegExp(`^(${daily})(?:-selection: \\d+ candidats \\(< \\d+\\) et shortage_reason non structuré| reserve too shallow without shortage_reason)$`, 'i'));
  if (depth) return {id: 'daily-reserve-' + depth[1].toLowerCase(),
    title: 'Compléter les réserves de ' + depth[1].toLowerCase() + ' ou documenter une pénurie réelle', kind: 'day'};
  if (/^Popularity radar reserve duplicates scan or public primary: /i.test(message)) {
    return {id: 'radar-popularity-overlap', title: 'Réconcilier les réserves et la sélection du radar de popularité', kind: 'radar'};
  }
  if (/^Popularity radar (?:distinct )?reserve too shallow$/i.test(message)) {
    return {id: 'radar-popularity-depth', title: 'Compléter les réserves distinctes du radar de popularité', kind: 'radar'};
  }
  // Keep every unknown defect as its own actionable observation. Do not guess
  // that two similar phrases have the same cause or completion evidence.
  return {id: 'observation-' + index, title: message, kind: gap.scope?.kind || 'global'};
}

export function buildTaskBoard({gaps = [], progress = null, observationsAvailable = true, observationsComplete = true} = {}) {
  const grouped = new Map();
  gaps.forEach((gap, index) => {
    const description = actionFor(gap, index);
    let action = grouped.get(description.id);
    if (!action) {
      action = {...description, blocking: false, messages: []};
      grouped.set(description.id, action);
    }
    if (gap.severity === 'blocking') action.blocking = true;
    action.messages.push(structuredClone(gap));
  });
  const actions = [...grouped.values()];
  return {
    notice: 'Suivi informatif : les actions calculées ne clôturent aucune exigence éditoriale et ne certifient pas la publication.',
    calculated: {status: !observationsAvailable ? 'unavailable' : observationsComplete ? 'observed' : 'partial',
      blocking_messages: observationsAvailable ? gaps.filter(g => g.severity === 'blocking').length : null,
      warning_messages: observationsAvailable ? gaps.filter(g => g.severity === 'warning').length : null,
      blocking_actions: observationsAvailable ? actions.filter(a => a.blocking).length : null,
      actions},
    declared: {status: progress ? 'requires_reconciliation' : 'unavailable',
      reconciliation_action: progress ? {id: 'reconcile-declared-requirements',
        title: 'Réconcilier les exigences déclarées avec les preuves et la candidate actuelle',
        closes_only_with_evidence: true} : null,
      paragraph_count: Array.isArray(progress?.remaining) ? progress.remaining.length : null,
      paragraphs: Array.isArray(progress?.remaining) ? structuredClone(progress.remaining) : [],
      structured_items: Array.isArray(progress?.remaining_items) ? structuredClone(progress.remaining_items) : null,
      editorial_review: editorialReviewState(progress)}
  };
}

const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
export function taskBoardMarkdown(board) {
  const calculated = board.calculated;
  const lines = ['### Actions calculées depuis les contrôles', '', '> ' + board.notice, ''];
  if (calculated.status === 'unavailable') lines.push('Contrôles actuels indisponibles : aucun nombre de blocages ne peut être déduit.');
  else {
    lines.push(`${calculated.blocking_messages} message(s) bloquant(s) regroupé(s) en ${calculated.blocking_actions} action(s) ; ${calculated.warning_messages} avertissement(s).`);
    if (calculated.status === 'partial') lines.push('Observation partielle : certains contrôles sont absents, ont échoué sans diagnostic exploitable, ou les entrées ont changé pendant leur exécution.');
    lines.push('', '| Action | Priorité | Messages conservés |', '|---|---|---:|');
    for (const action of calculated.actions) lines.push(`| ${cell(action.title)} | ${action.blocking ? 'Bloquante' : 'Avertissement'} | ${action.messages.length} |`);
  }
  lines.push('', '### Suivi éditorial déclaré à réconcilier', '',
    `${board.declared.paragraph_count ?? '?'} paragraphe(s) déclaré(s), à rapprocher des preuves et de la candidate actuelle. Ce nombre n'est pas un compte de tâches actives.`,
    `Revue éditoriale déclarée achevée : ${board.declared.editorial_review.declared_completed ? 'oui' : 'non'} ; ce rapport ne la certifie pas.`);
  if (board.declared.reconciliation_action) lines.push('Action de suivi : ' + board.declared.reconciliation_action.title + '. Chaque clôture exige sa preuve.');
  return lines.join('\n') + '\n';
}
